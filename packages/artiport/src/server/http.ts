export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string = code,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.code, message: error.message }, { status: error.status });
  }
  console.error('[artiport]', error);
  const message = error instanceof Error ? error.message : 'Internal error';
  return json({ error: 'internal_error', message }, { status: 500 });
}

/** Blocks cross-site writes: the body must be JSON and the request must come from this origin. */
export function assertSameOriginJson(request: Request): void {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw new HttpError(403, 'cross_site_request');
  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
    if (new URL(origin).host !== host) throw new HttpError(403, 'bad_origin');
  }
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/json')) throw new HttpError(415, 'expected_json');
}

export async function readJson<T>(request: Request, maxBytes = 4_000_000): Promise<T> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError(413, 'payload_too_large');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}
