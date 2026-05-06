import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import {
  NotificationEventType,
  NotificationPreferences,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../api/notifications';

const EVENT_TYPE_LABELS: Record<NotificationEventType, string> = {
  version_published: 'New version published',
  migration_complete: 'Migration complete',
  migration_failed: 'Migration failed',
  annotation_flagged: 'Annotation flagged',
  member_added: 'Member added',
  role_changed: 'Role changed',
  ensemble_renamed: 'Ensemble renamed',
  version_opened: 'Version opened (director)',
};

const EVENT_TYPES: NotificationEventType[] = [
  'version_published',
  'migration_complete',
  'migration_failed',
  'annotation_flagged',
  'member_added',
  'role_changed',
  'ensemble_renamed',
  'version_opened',
];

export function NotificationPreferencesPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getNotificationPreferences()
      .then(setPrefs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggleMasterEmail() {
    if (!prefs) return;
    setSaving(true);
    try {
      const updated = await updateNotificationPreferences({
        masterEmailEnabled: !prefs.masterEmailEnabled,
      });
      setPrefs(updated);
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function togglePref(eventType: NotificationEventType, field: 'inAppEnabled' | 'emailEnabled') {
    if (!prefs) return;
    const current = prefs.preferences[eventType];
    if (!current) return;
    setSaving(true);
    try {
      const updated = await updateNotificationPreferences({
        preferences: {
          [eventType]: { [field]: !current[field] },
        },
      });
      setPrefs(updated);
    } catch { /* ignore */ }
    setSaving(false);
  }

  if (loading) {
    return (
      <Layout
        title="Notification Preferences"
        backTo="/notifications"
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Notifications', to: '/notifications' },
          { label: 'Preferences' },
        ]}
      >
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </Layout>
    );
  }

  if (!prefs) {
    return (
      <Layout
        title="Notification Preferences"
        backTo="/notifications"
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Notifications', to: '/notifications' },
          { label: 'Preferences' },
        ]}
      >
        <p style={{ color: 'var(--text-muted)' }}>Failed to load preferences.</p>
      </Layout>
    );
  }

  return (
    <Layout
      title="Notification Preferences"
      backTo="/notifications"
      breadcrumbs={[
        { label: 'Home', to: '/' },
        { label: 'Notifications', to: '/notifications' },
        { label: 'Preferences' },
      ]}
    >
      {/* Master email toggle */}
      <div style={{
        padding: '16px 20px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Email notifications</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Master switch — disables all email notifications when off
          </div>
        </div>
        <Button
          size="sm"
          variant={prefs.masterEmailEnabled ? 'primary' : 'secondary'}
          onClick={toggleMasterEmail}
          disabled={saving}
        >
          {prefs.masterEmailEnabled ? 'On' : 'Off'}
        </Button>
      </div>

      {/* Per-event preferences */}
      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 80px 80px',
          padding: '10px 20px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          <span>Event</span>
          <span style={{ textAlign: 'center' }}>In-app</span>
          <span style={{ textAlign: 'center' }}>Email</span>
        </div>

        {EVENT_TYPES.map((eventType, i) => {
          const pref = prefs.preferences[eventType];
          if (!pref) return null;
          return (
            <div
              key={eventType}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 80px 80px',
                padding: '12px 20px',
                borderBottom: i < EVENT_TYPES.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13 }}>{EVENT_TYPE_LABELS[eventType]}</span>
              <div style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={pref.inAppEnabled}
                  onChange={() => togglePref(eventType, 'inAppEnabled')}
                  disabled={saving}
                  style={{ cursor: 'pointer' }}
                />
              </div>
              <div style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={pref.emailEnabled}
                  onChange={() => togglePref(eventType, 'emailEnabled')}
                  disabled={saving || !prefs.masterEmailEnabled}
                  style={{ cursor: saving || !prefs.masterEmailEnabled ? 'not-allowed' : 'pointer', opacity: prefs.masterEmailEnabled ? 1 : 0.4 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 12 }}>
        Changes are saved automatically. Email checkboxes are disabled when the master email switch is off.
      </p>
    </Layout>
  );
}
