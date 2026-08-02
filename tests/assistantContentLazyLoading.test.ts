import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

const root = resolve(import.meta.dirname, '..');

function modulePath(id: string): string {
  return id.replaceAll('\\', '/');
}

describe('assistant content bundle boundary', () => {
  it('keeps marked and DOMPurify out of the main chunk', async () => {
    const result = await build({
      root,
      logLevel: 'silent',
      build: {
        write: false,
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap((output) => output.output)
      .filter((item): item is Rollup.OutputChunk => item.type === 'chunk');
    const mainChunk = chunks.find((chunk) => chunk.isEntry);
    const assistantChunk = chunks.find((chunk) => Object.keys(chunk.modules)
      .some((id) => modulePath(id).endsWith('/src/ui/assistantContent.ts')));
    const settingsChunk = chunks.find((chunk) => Object.keys(chunk.modules)
      .some((id) => modulePath(id).endsWith('/src/pages/Settings.ts')));

    expect(mainChunk).toBeDefined();
    expect(assistantChunk).toBeDefined();
    expect(settingsChunk).toBeDefined();
    expect(Object.keys(mainChunk?.modules ?? {}).map(modulePath)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/node_modules\/marked\//),
        expect.stringMatching(/\/node_modules\/dompurify\//),
      ]),
    );
    expect(Object.keys(assistantChunk?.modules ?? {}).map(modulePath)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/node_modules\/marked\//),
        expect.stringMatching(/\/node_modules\/dompurify\//),
      ]),
    );
    expect([...mainChunk?.viteMetadata?.importedCss ?? []]).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/Settings-.*\.css$/)]),
    );
    expect([...settingsChunk?.viteMetadata?.importedCss ?? []]).toEqual(
      expect.arrayContaining([expect.stringMatching(/Settings-.*\.css$/)]),
    );
  }, 30_000);
});
