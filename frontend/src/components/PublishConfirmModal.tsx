import { Button } from './Button';

interface PublishStat {
  label: string;
  count: number;
}

export function PublishConfirmModal({
  versionName,
  stats,
  onDone,
  onViewDiff,
}: {
  versionName: string;
  stats: PublishStat[];
  onDone: () => void;
  onViewDiff?: () => void;
}) {
  return (
    <div className="publish-backdrop" onClick={onDone}>
      <div className="publish-card" onClick={e => e.stopPropagation()}>
        <div className="pc-check">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 14 L12 19 L21 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2>{versionName} is live</h2>
        <p className="pc-summary">
          Published &middot; here's what changed
        </p>

        {stats.length > 0 && (
          <div className="pc-breakdown">
            {stats.map((s, i) => (
              <div className="pc-stat" key={i}>
                <div className="pc-num">{s.count > 0 ? `+${s.count}` : s.count}</div>
                <div className="pc-lab">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="pc-actions">
          <Button variant="secondary" onClick={onDone}>Done</Button>
          {onViewDiff && (
            <Button onClick={onViewDiff}>View version detail</Button>
          )}
        </div>
      </div>
    </div>
  );
}
