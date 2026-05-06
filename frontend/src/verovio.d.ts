declare module 'verovio' {
  interface VerovioToolkit {
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(page: number): string;
  }

  function createToolkit(): Promise<VerovioToolkit>;

  const _default: {
    createToolkit: typeof createToolkit;
  };
  export default _default;
}
