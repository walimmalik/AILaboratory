import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'ok' | 'unreachable';

export function App() {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((response) => setStatus(response.ok ? 'ok' : 'unreachable'))
      .catch(() => setStatus('unreachable'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>AILaboratory</h1>
      <p>API: {status}</p>
    </main>
  );
}
