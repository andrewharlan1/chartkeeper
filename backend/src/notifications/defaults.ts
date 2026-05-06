import type { NotificationEventType } from '../schema';

export interface NotificationPreference {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  /** If true, only directors (owner/admin) of the relevant ensemble receive this by default */
  directorOnly?: boolean;
}

export const DEFAULT_PREFERENCES: Record<NotificationEventType, NotificationPreference> = {
  version_published:  { inAppEnabled: true,  emailEnabled: true },
  migration_complete: { inAppEnabled: true,  emailEnabled: true },
  migration_failed:   { inAppEnabled: true,  emailEnabled: true },
  annotation_flagged: { inAppEnabled: true,  emailEnabled: false },
  member_added:       { inAppEnabled: true,  emailEnabled: true },
  role_changed:       { inAppEnabled: true,  emailEnabled: true },
  ensemble_renamed:   { inAppEnabled: true,  emailEnabled: false },
  version_opened:     { inAppEnabled: true,  emailEnabled: false, directorOnly: true },
};

/** Human-readable labels for notification settings UI */
export const EVENT_TYPE_LABELS: Record<NotificationEventType, string> = {
  version_published:  'New version published',
  migration_complete: 'Migration complete',
  migration_failed:   'Migration failed',
  annotation_flagged: 'Annotation flagged',
  member_added:       'Member added',
  role_changed:       'Role changed',
  ensemble_renamed:   'Ensemble renamed',
  version_opened:     'Version opened (director)',
};
