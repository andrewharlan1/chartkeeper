import { Part } from '../types';
import { InlinePdfRenderer } from './InlinePdfRenderer';
import { LinkCard } from './LinkCard';
import { AudioPlayer } from './AudioPlayer';
import { FileDownloadCard } from './FileDownloadCard';

interface Props {
  part: Part;
  versionId?: string;
  title?: string;
}

export function PartRenderer({ part, versionId }: Props) {
  switch (part.kind) {
    case 'part':
    case 'score':
    case 'chart':
      return (
        <div style={{ height: 400, position: 'relative', overflow: 'hidden', borderRadius: 6, background: 'var(--surface-raised, #f8f4ef)' }}>
          <InlinePdfRenderer
            partId={part.id}
            pdfUrl={`/parts/${part.id}/pdf`}
            currentPage={1}
            zoomPercent={100}
            darkScore={false}
            annotationsVisible={false}
            showDiffHighlights={false}
            versionId={versionId}
            annotationMode="read"
            inkColor="#000000"
            onInkColorChange={() => {}}
            textColor="#000000"
            onTextColorChange={() => {}}
            highlightColor="rgba(253, 224, 71, 0.3)"
            onHighlightColorChange={() => {}}
            fontSize={0.018}
            fontFamily="sans-serif"
            selectedAnnotationId={null}
            onSelectionChange={() => {}}
          />
        </div>
      );
    case 'link':
      return <LinkCard url={part.linkUrl ?? ''} title={part.name} />;
    case 'audio':
      return (
        <AudioPlayer
          src={`/parts/${part.id}/file`}
          title={part.name}
          duration={part.audioDurationSeconds}
        />
      );
    case 'other':
      return <FileDownloadCard fileUrl={`/parts/${part.id}/file`} name={part.name} />;
    default:
      return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Unknown content type</div>;
  }
}
