import { Part } from '../types';
import { PdfViewer } from './PdfViewer';
import { LinkCard } from './LinkCard';
import { AudioPlayer } from './AudioPlayer';
import { FileDownloadCard } from './FileDownloadCard';

interface Props {
  part: Part;
  versionId?: string;
  title?: string;
}

export function PartRenderer({ part, versionId, title }: Props) {
  switch (part.kind) {
    case 'part':
    case 'score':
    case 'chart':
      return (
        <PdfViewer
          url={`/parts/${part.id}/pdf`}
          partId={part.id}
          versionId={versionId}
          title={title ?? part.name}
        />
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
