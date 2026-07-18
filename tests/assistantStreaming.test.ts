import { describe, expect, it } from 'vitest';
import { readStreamingReply } from '../src/ai/assistant';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

describe('assistant streaming responses', () => {
  it('emits text deltas while assembling the final reply', async () => {
    const deltas: string[] = [];
    const result = await readStreamingReply(streamOf(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，今天好"}}]}\n\n',
      'data: [DONE]\n\n',
    ), (value) => deltas.push(value));

    expect(deltas).toEqual(['你好', '，今天好']);
    expect(result).toMatchObject({ content: '你好，今天好' });
  });

  it('assembles fragmented tool-call arguments', async () => {
    const first = JSON.stringify({
      choices: [{ delta: {
        tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'web_search_exa', arguments: '{"query":"' } }],
      } }],
    });
    const second = JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'Exa MCP"}' } }] } }],
    });
    const result = await readStreamingReply(streamOf(
      `data: ${first}\n\n`,
      `data: ${second}\n\n`,
      'data: [DONE]\n\n',
    ));

    expect(result.tool_calls).toEqual([{
      id: 'call-1',
      type: 'function',
      function: { name: 'web_search_exa', arguments: '{"query":"Exa MCP"}' },
    }]);
  });
});
