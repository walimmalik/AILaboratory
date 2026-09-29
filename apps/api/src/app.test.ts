import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('api', () => {
  it('reports health', async () => {
    const response = await createApp().request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'api' });
  });

  it('returns 404 for unknown routes', async () => {
    const response = await createApp().request('/nope');
    expect(response.status).toBe(404);
  });
});
