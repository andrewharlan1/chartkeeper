import { useState } from 'react';
import { ValidOperation, applyEdit, saveEdit } from '../../api/edits';
import { AskPalette } from './AskPalette';
import { OperationPreview } from './OperationPreview';
import { VerovioRenderer } from './VerovioRenderer';
import { RangeWarningModal } from './RangeWarningModal';
import { SaveAsDialog } from './SaveAsDialog';
import { Button } from '../Button';

interface Props {
  partId: string;
  versionId: string;
  partName: string;
  isDirector: boolean;
  onSaved: (newVersionId: string) => void;
  onExit: () => void;
}

type EditorState =
  | { step: 'input' }
  | { step: 'preview_op'; operation: ValidOperation; naturalLanguage: string }
  | { step: 'applying' }
  | { step: 'result'; musicxml: string; operation: ValidOperation; naturalLanguage: string; rangeWarnings: Array<{ measure: number; pitch: string; reason: string }> }
  | { step: 'range_warning'; musicxml: string; operation: ValidOperation; naturalLanguage: string; warnings: Array<{ measure: number; pitch: string; reason: string }> }
  | { step: 'save_dialog'; musicxml: string; operation: ValidOperation; naturalLanguage: string }
  | { step: 'saving' };

export function EditorPanel({ partId, versionId, partName, isDirector, onSaved, onExit }: Props) {
  const [state, setState] = useState<EditorState>({ step: 'input' });

  function handleOperation(op: ValidOperation, naturalLanguage: string) {
    setState({ step: 'preview_op', operation: op, naturalLanguage });
  }

  async function handleApply() {
    if (state.step !== 'preview_op') return;
    const { operation, naturalLanguage } = state;

    setState({ step: 'applying' });

    try {
      const result = await applyEdit({ partId, versionId, operation });

      if (result.rangeWarnings && result.rangeWarnings.length > 0) {
        setState({
          step: 'range_warning',
          musicxml: result.transformedMusicxml,
          operation,
          naturalLanguage,
          warnings: result.rangeWarnings,
        });
      } else {
        setState({
          step: 'result',
          musicxml: result.transformedMusicxml,
          operation,
          naturalLanguage,
          rangeWarnings: [],
        });
      }
    } catch (err) {
      setState({ step: 'preview_op', operation, naturalLanguage });
      alert(err instanceof Error ? err.message : 'Apply failed');
    }
  }

  function handleRangeApplyAnyway() {
    if (state.step !== 'range_warning') return;
    setState({
      step: 'result',
      musicxml: state.musicxml,
      operation: state.operation,
      naturalLanguage: state.naturalLanguage,
      rangeWarnings: state.warnings,
    });
  }

  function handleRangeCancel() {
    setState({ step: 'input' });
  }

  function handleShowSaveDialog() {
    if (state.step !== 'result') return;
    setState({
      step: 'save_dialog',
      musicxml: state.musicxml,
      operation: state.operation,
      naturalLanguage: state.naturalLanguage,
    });
  }

  async function handleSave(mode: 'personal' | 'ensemble', label: string) {
    if (state.step !== 'save_dialog') return;
    const { musicxml, operation, naturalLanguage } = state;

    setState({ step: 'saving' });

    try {
      const result = await saveEdit({
        partId,
        parentVersionId: versionId,
        transformedMusicXml: musicxml,
        operationJson: operation,
        naturalLanguageInput: naturalLanguage,
        saveMode: mode,
        branchLabel: mode === 'personal' ? label : undefined,
        versionLabel: mode === 'ensemble' ? label : undefined,
      });
      onSaved(result.version.id);
    } catch (err) {
      setState({
        step: 'save_dialog',
        musicxml,
        operation,
        naturalLanguage,
      });
      alert(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          Editor — {partName}
        </div>
        <Button size="sm" variant="secondary" onClick={onExit}>
          Exit edit mode
        </Button>
      </div>

      {/* Ask Palette (always visible in input/preview states) */}
      {(state.step === 'input' || state.step === 'preview_op' || state.step === 'applying') && (
        <AskPalette partId={partId} versionId={versionId} onOperation={handleOperation} />
      )}

      {/* Operation preview */}
      {state.step === 'preview_op' && (
        <OperationPreview
          operation={state.operation}
          onApply={handleApply}
          onCancel={() => setState({ step: 'input' })}
        />
      )}

      {/* Applying spinner */}
      {state.step === 'applying' && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Transforming score...
        </div>
      )}

      {/* Verovio result */}
      {(state.step === 'result' || state.step === 'save_dialog' || state.step === 'saving') && 'musicxml' in state && (
        <>
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 16,
            background: '#fff',
            maxHeight: 500,
            overflowY: 'auto',
          }}>
            <VerovioRenderer musicxml={state.musicxml} />
          </div>
          {state.step === 'result' && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button size="sm" variant="secondary" onClick={() => setState({ step: 'input' })}>
                Try another edit
              </Button>
              <Button size="sm" variant="primary" onClick={handleShowSaveDialog}>
                Save
              </Button>
            </div>
          )}
        </>
      )}

      {/* Range warning modal */}
      {state.step === 'range_warning' && (
        <RangeWarningModal
          warnings={state.warnings}
          instrumentName={partName}
          onApplyAnyway={handleRangeApplyAnyway}
          onCancel={handleRangeCancel}
        />
      )}

      {/* Save dialog */}
      {state.step === 'save_dialog' && (
        <SaveAsDialog
          isDirector={isDirector}
          onSave={handleSave}
          onCancel={() => setState({
            step: 'result',
            musicxml: state.musicxml,
            operation: state.operation,
            naturalLanguage: state.naturalLanguage,
            rangeWarnings: [],
          })}
        />
      )}

      {/* Saving spinner */}
      {state.step === 'saving' && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Saving version...
        </div>
      )}
    </div>
  );
}
