export class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new RequestBodyError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const contentEncoding = request.headers.get('content-encoding');
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    throw new RequestBodyError(415, 'unsupported_content_encoding', 'Compressed request bodies are not accepted.');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new RequestBodyError(400, 'invalid_content_length', 'Invalid Content-Length header.');
    }
    if (bytes > maxBytes) throw new RequestBodyError(413, 'body_too_large', 'Request body is too large.');
  }
  if (!request.body) throw new RequestBodyError(400, 'missing_body', 'A JSON request body is required.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, 'body_too_large', 'Request body is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new RequestBodyError(400, 'invalid_utf8', 'Request body must be valid UTF-8.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError(400, 'bad_json', 'Request body must be valid JSON.');
  }
}

export function internalJson(data: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}
