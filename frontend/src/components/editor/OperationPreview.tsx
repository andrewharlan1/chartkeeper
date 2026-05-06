import { ValidOperation } from '../../api/edits';
import { Button } from '../Button';

interface Props {
  operation: ValidOperation;
  onApply: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const INTERVAL_LABELS: Record<string, string> = {
  up_half_step: 'up a half step',
  down_half_step: 'down a half step',
  up_whole_step: 'up a whole step',
  down_whole_step: 'down a whole step',
  up_minor_third: 'up a minor third',
  down_minor_third: 'down a minor third',
  up_major_third: 'up a major third',
  down_major_third: 'down a major third',
  up_perfect_fourth: 'up a perfect fourth',
  down_perfect_fourth: 'down a perfect fourth',
  up_perfect_fifth: 'up a perfect fifth',
  down_perfect_fifth: 'down a perfect fifth',
  up_octave: 'up an octave',
  down_octave: 'down an octave',
};

const INSTRUMENT_LABELS: Record<string, string> = {
  flute: 'Flute',
  trumpet_in_bb: 'Trumpet in B\u266D',
  horn_in_f: 'Horn in F',
  alto_saxophone: 'Alto Saxophone',
  tenor_saxophone: 'Tenor Saxophone',
  clarinet_in_bb: 'Clarinet in B\u266D',
  violin: 'Violin',
  viola: 'Viola',
  cello: 'Cello',
};

function describeOperation(op: ValidOperation): string {
  if (op.op === 'transpose') {
    const intervalLabel = INTERVAL_LABELS[op.interval] || op.interval;
    const scope = op.scope === 'whole_part'
      ? 'the whole part'
      : `measures ${op.scope.measureRange[0]}\u2013${op.scope.measureRange[1]}`;
    return `Transpose ${scope} ${intervalLabel}.`;
  }
  if (op.op === 'octave_displace') {
    const scope = op.scope === 'whole_part'
      ? 'the whole part'
      : `measures ${op.scope.measureRange[0]}\u2013${op.scope.measureRange[1]}`;
    return `Move ${scope} ${op.direction} one octave.`;
  }
  if (op.op === 'instrument_change') {
    const label = INSTRUMENT_LABELS[op.newInstrument] || op.newInstrument;
    return `Change instrument to ${label} (auto-transpose).`;
  }
  return 'Unknown operation';
}

export function OperationPreview({ operation, onApply, onCancel, loading }: Props) {
  return (
    <div style={{
      padding: '12px 16px',
      background: 'rgba(59,130,246,0.04)',
      border: '1px solid rgba(59,130,246,0.2)',
      borderRadius: 10,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>
        {describeOperation(operation)}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={onApply} disabled={loading}>
          {loading ? 'Applying...' : 'Apply'}
        </Button>
      </div>
    </div>
  );
}
