import apn from '@parse/node-apn';
import webpush from 'web-push';

// ── APN setup ────────────────────────────────────────────────────────────────

let apnProvider: apn.Provider | null = null;

function getApnProvider(): apn.Provider | null {
  if (apnProvider) return apnProvider;

  const keyPath = process.env.APN_KEY_PATH;
  const keyId = process.env.APN_KEY_ID;
  const teamId = process.env.APN_TEAM_ID;

  if (!keyPath || !keyId || !teamId) return null;

  apnProvider = new apn.Provider({
    token: { key: keyPath, keyId, teamId },
    production: process.env.NODE_ENV === 'production',
  });
  return apnProvider;
}

// ── Web push setup ────────────────────────────────────────────────────────────

let webPushConfigured = false;

function ensureWebPush(): boolean {
  if (webPushConfigured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const mailto = process.env.VAPID_MAILTO;

  if (!publicKey || !privateKey || !mailto) return false;

  webpush.setVapidDetails(`mailto:${mailto}`, publicKey, privateKey);
  webPushConfigured = true;
  return true;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface DeviceToken {
  token: string;
  platform: 'ios' | 'web';
  webEndpoint?: string;
  webP256dh?: string;
  webAuth?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// ── Send functions ────────────────────────────────────────────────────────────

async function sendIos(token: string, payload: PushPayload): Promise<void> {
  const provider = getApnProvider();
  if (!provider) {
    console.log(`[push] APN not configured — skipping iOS push to ${token.slice(0, 8)}…`);
    return;
  }

  const note = new apn.Notification();
  note.alert = { title: payload.title, body: payload.body };
  note.topic = process.env.APN_BUNDLE_ID!;
  note.payload = payload.data ?? {};
  note.sound = 'default';

  const result = await provider.send(note, token);
  if (result.failed.length > 0) {
    console.warn(`[push] APN send failed for token ${token.slice(0, 8)}…:`, result.failed[0].error);
  }
}

async function sendWeb(device: DeviceToken, payload: PushPayload): Promise<void> {
  if (!ensureWebPush()) {
    console.log(`[push] Web push not configured — skipping push to ${device.token.slice(0, 8)}…`);
    return;
  }
  if (!device.webEndpoint || !device.webP256dh || !device.webAuth) return;

  try {
    await webpush.sendNotification(
      { endpoint: device.webEndpoint, keys: { p256dh: device.webP256dh, auth: device.webAuth } },
      JSON.stringify({ title: payload.title, body: payload.body, data: payload.data })
    );
  } catch (err: any) {
    // 410 Gone = subscription expired / unsubscribed
    if (err.statusCode === 410) {
      console.log(`[push] Web push subscription expired: ${device.webEndpoint}`);
      throw Object.assign(err, { expired: true });
    }
    throw err;
  }
}

export async function sendPush(device: DeviceToken, payload: PushPayload): Promise<void> {
  if (device.platform === 'ios') {
    await sendIos(device.token, payload);
  } else {
    await sendWeb(device, payload);
  }
}
