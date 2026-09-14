import type { PullRequest, PullResponse, SyncRequest, SyncResponse } from '../shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string = code,
  ) {
    super(message);
  }
}

export interface SyncApi {
  pull(body: PullRequest): Promise<PullResponse>;
  sync(body: SyncRequest, options?: { keepalive?: boolean }): Promise<SyncResponse>;
}

/** Browsers refuse keepalive bodies above 64 KiB. */
const KEEPALIVE_LIMIT = 60_000;

export function httpApi(base = ''): SyncApi {
  return {
    pull: (body) => postJson<PullResponse>(`${base}/api/pull`, body),
    sync: (body, options) => postJson<SyncResponse>(`${base}/api/sync`, body, options?.keepalive),
  };
}

export async function postJson<T>(url: string, body: unknown, keepalive = false): Promise<T> {
  const payload = JSON.stringify(body);
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: payload,
    keepalive: keepalive && payload.length < KEEPALIVE_LIMIT,
  });
  if (!response.ok) {
    let code = `http_${response.status}`;
    let message: string | undefined;
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      code = data.error ?? code;
      message = data.message;
    } catch {
      // not a JSON error body
    }
    throw new ApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}
