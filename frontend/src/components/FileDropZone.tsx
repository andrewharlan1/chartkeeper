import { useState, useRef, DragEvent, ChangeEvent } from 'react';

interface Props {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
}

export function FileDropZone({
  onFiles,
  accept = '.pdf,application/pdf',
  multiple = true,
  label = 'Drop PDF files here, or click to browse',
  hint = 'Select as many files as you like',
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      onFiles(Array.from(e.target.files));
    }
    e.target.value = '';
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '28px 24px',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragOver ? 'rgba(99,102,241,0.06)' : 'var(--surface)',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <p style={{ color: dragOver ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 4, fontWeight: 500 }}>
        {dragOver ? 'Drop to add files' : label}
      </p>
      {hint && (
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{hint}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />
    </div>
  );
}
