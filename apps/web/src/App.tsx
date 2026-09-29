import { useEffect, useState } from 'react';
import { api } from './api.ts';

type ApiStatus = 'checking' | 'ok' | 'unreachable';

export function App() {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    api.health().then((ok) => setStatus(ok ? 'ok' : 'unreachable'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>AILaboratory</h1>
      <p>API: {status}</p>
    </main>
  );
}
