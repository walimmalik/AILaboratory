import { recordsGet } from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { ApiError, createClient } from './index.ts';

const id = `wdg_${'0'.repeat(26)}`;

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

describe('client', () => {
  it('posts to the operation route with the token and preview flag', async () => {
    const { calls, fetch } = fakeFetch(200, { status: 'proposed', proposal: undefined });
    const client = createClient({ baseUrl: '/api/', token: 't0k', fetch });
    await client.call(recordsGet, { id }, { preview: true }).catch(() => undefined);
    const [first] = calls;
    expect(first?.url).toBe('/api/v1/ops/records.get?preview=true');
    expect(first?.init?.headers).toMatchObject({ authorization: 'Bearer t0k' });
    expect(first?.init?.body).toBe(JSON.stringify({ id }));
  });

  it('turns refusals into ApiError with the server code', async () => {
    const { fetch } = fakeFetch(404, { code: 'not_found', message: 'No record' });
    const client = createClient({ baseUrl: '/api', fetch });
    const error = await client.run(recordsGet, { id }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('not_found');
    expect((error as ApiError).status).toBe(404);
  });
});
