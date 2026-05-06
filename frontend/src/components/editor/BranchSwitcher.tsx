interface VersionOption {
  id: string;
  name: string;
  privateOwnerUserId: string | null;
  branchLabel: string | null;
}

interface Props {
  versions: VersionOption[];
  currentVersionId: string;
  onSwitch: (versionId: string) => void;
}

export function BranchSwitcher({ versions, currentVersionId, onSwitch }: Props) {
  const ensembleVersions = versions.filter(v => !v.privateOwnerUserId);
  const personalVersions = versions.filter(v => !!v.privateOwnerUserId);

  return (
    <select
      value={currentVersionId}
      onChange={e => onSwitch(e.target.value)}
      style={{
        padding: '4px 8px',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 12,
        fontFamily: 'var(--mono)',
        background: 'var(--surface)',
        color: 'var(--text)',
        cursor: 'pointer',
        maxWidth: 240,
      }}
    >
      {ensembleVersions.map(v => (
        <option key={v.id} value={v.id}>
          {v.name} (ensemble)
        </option>
      ))}
      {personalVersions.length > 0 && (
        <optgroup label="Your personal versions">
          {personalVersions.map(v => (
            <option key={v.id} value={v.id}>
              {v.branchLabel || v.name} (personal)
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
