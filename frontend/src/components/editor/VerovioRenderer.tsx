import { useEffect, useRef, useState } from 'react';

interface Props {
  musicxml: string;
  scale?: number;
}

export function VerovioRenderer({ musicxml, scale = 40 }: Props) {
  const [svgPages, setSvgPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toolkitRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setLoading(true);
      setError(null);

      try {
        // Dynamic import of verovio
        const verovio = await import('verovio');
        const VerovioModule = verovio.default || verovio;

        if (!toolkitRef.current) {
          const tk = await VerovioModule.createToolkit();
          toolkitRef.current = tk;
        }

        const toolkit = toolkitRef.current;
        toolkit.setOptions({
          scale,
          pageWidth: 2000,
          adjustPageHeight: true,
          footer: 'none',
          header: 'none',
        });

        toolkit.loadData(musicxml);
        const pageCount = toolkit.getPageCount();
        const pages: string[] = [];
        for (let i = 1; i <= pageCount; i++) {
          pages.push(toolkit.renderToSVG(i));
        }

        if (!cancelled) {
          setSvgPages(pages);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Verovio render failed');
          setLoading(false);
        }
      }
    }

    if (musicxml) {
      render();
    }

    return () => { cancelled = true; };
  }, [musicxml, scale]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Rendering score...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger, #e53e3e)', fontSize: 13 }}>
        Render error: {error}
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      {svgPages.map((svg, i) => (
        <div
          key={i}
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{ marginBottom: 8 }}
        />
      ))}
    </div>
  );
}
