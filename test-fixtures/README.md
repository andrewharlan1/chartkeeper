# Diff Test Fixtures

Each subdirectory contains a PDF pair: `v1.pdf` and `v2.pdf`.

To run live tests:
```
ANTHROPIC_API_KEY=sk-ant-... npx vitest run src/lib/vision-diff.test.ts
```

## Fixture pairs

| Dir | Instrument | Description |
|-----|------------|-------------|
| 01-disposition-v1-v2 | Bass | Disposition bass, July → September edition |
| 02-disposition-v2-v3 | Bass | Disposition bass, September → October edition |
| 03-cello-small-change | Cello | Cello score, one small change |

