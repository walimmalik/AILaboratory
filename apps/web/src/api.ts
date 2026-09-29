import { createClient } from '@ailab/client';

/** The one way the web app talks to the API. Sign-in and tokens arrive with plan 004. */
export const api = createClient({ baseUrl: '/api' });
