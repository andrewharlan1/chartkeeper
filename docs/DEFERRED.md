# Deferred Features

## Push Notifications (device_tokens + APNs/Web Push)

**Status:** Scaffolded, not wired up.

**What exists:**
- Migration `004_device_tokens.sql` creates the `device_tokens` table
- `backend/src/lib/push.ts` has APNs and web-push send logic
- `backend/src/routes/deviceTokens.ts` has POST/DELETE endpoints (stubbed — returns 201/204 without DB interaction)
- Route is mounted at `/device-tokens` in `index.ts`

**What's missing to ship:**
- Add `device_tokens` to the Drizzle schema (`backend/src/schema.ts`)
- Implement the `deviceTokens.ts` route: validate input, upsert/delete tokens in DB
- Update `notifications.ts` to query device_tokens and call `sendPush` after writing notification rows
- Update tests to cover full registration, deregistration, and push delivery flows
- Configure APNs credentials (APN_KEY_PATH, APN_KEY_ID, APN_TEAM_ID) and VAPID keys for web push
