import { requireAiConsent } from './consent';

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp?tools=web_search_exa';
const MAX_QUERY_LENGTH = 500;
const MAX_RESULT_CHARACTERS = 12_000;

interface ExaSearchSource {
  title: string;
  url: string;
}

export interface ExaSearchResult {
  content: string;
  sources: ExaSearchSource[];
  truncated: boolean;
}

type McpClient = import('@modelcontextprotocol/sdk/client/index.js').Client;
let clientPromise: Promise<McpClient> | null = null;

async function connectClient(): Promise<McpClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
      ]);
      const client = new Client({ name: 'medbox-exa-client', version: '0.7.8' });
      const transport = new StreamableHTTPClientTransport(new URL(EXA_MCP_URL));
      await client.connect(transport);
      const listed = await client.listTools(undefined, { timeout: 10_000, maxTotalTimeout: 10_000 });
      if (!listed.tools.some((tool) => tool.name === 'web_search_exa')) {
        await client.close();
        throw new Error('Exa 搜索工具当前不可用');
      }
      return client;
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function searchExaWeb(query: string, numResults = 5): Promise<ExaSearchResult> {
  const normalized = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!normalized) throw new Error('请提供要搜索的内容');
  await requireAiConsent('web-search', EXA_MCP_URL);
  const limit = Math.max(1, Math.min(5, Math.floor(numResults) || 5));
  let retried = false;
  while (true) {
    try {
      const client = await connectClient();
      const result = await client.callTool(
        { name: 'web_search_exa', arguments: { query: normalized, numResults: limit } },
        undefined,
        { timeout: 18_000, maxTotalTimeout: 20_000 },
      );
      if (result.isError) throw new Error(textContent(result.content) || 'Exa 搜索失败');
      const raw = textContent(result.content);
      const truncated = raw.length > MAX_RESULT_CHARACTERS;
      const content = raw.slice(0, MAX_RESULT_CHARACTERS);
      return { content, sources: extractSources(content, limit), truncated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!retried && /session|404|closed|not initialized/i.test(message)) {
        retried = true;
        const current = clientPromise;
        clientPromise = null;
        await current?.then((client) => client.close()).catch(() => undefined);
        continue;
      }
      if (/429|rate limit/i.test(message)) throw new Error('Exa 公共搜索请求过多，请稍后重试');
      if (/timeout|timed out/i.test(message)) throw new Error('联网搜索响应超时，请稍后重试');
      throw new Error('Exa 公共搜索暂时不可用，请稍后重试');
    }
  }
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.filter((item): item is { type: string; text: string } =>
    !!item && typeof item === 'object'
    && (item as { type?: unknown }).type === 'text'
    && typeof (item as { text?: unknown }).text === 'string',
  )
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

function extractSources(content: string, limit: number): ExaSearchSource[] {
  const sources: ExaSearchSource[] = [];
  const seen = new Set<string>();
  const matches = content.matchAll(/https?:\/\/[^\s<>"')\]]+/g);
  for (const match of matches) {
    const url = match[0].replace(/[.,;:!?]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    let title = `来源 ${sources.length + 1}`;
    try { title = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep fallback */ }
    sources.push({ title, url });
    if (sources.length >= limit) break;
  }
  return sources;
}
