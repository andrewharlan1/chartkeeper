import { Modal } from './Modal';
import { Button } from './Button';
import { MigrationStatusJob } from '../api/versions';

interface Props {
  jobs: MigrationStatusJob[];
  onRetry: () => void;
  onClose: () => void;
}

export function MigrationFailureModal({ jobs, onRetry, onClose }: Props) {
  const failed = jobs.filter(j => j.status === 'failed');
  const succeeded = jobs.filter(j => j.status === 'complete');

  return (
    <Modal title="Migration results" onClose={onClose}>
      {succeeded.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, marginBottom: 4 }}>
            Succeeded ({succeeded.length})
          </p>
          {succeeded.map(j => (
            <div key={j.id} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0' }}>
              {j.sources.length} source{j.sources.length !== 1 ? 's' : ''} migrated
            </div>
          ))}
        </div>
      )}

      {failed.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 500, marginBottom: 4 }}>
            Failed ({failed.length})
          </p>
          {failed.map(j => (
            <div key={j.id} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0' }}>
              {j.error || 'Unknown error'}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {failed.length > 0 && (
          <Button variant="primary" onClick={onRetry}>Retry failed</Button>
        )}
      </div>
    </Modal>
  );
}
