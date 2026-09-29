import { execFileSync } from 'node:child_process';

/** Issues an agent token for the tests, the same way a person connects an outside agent. */
export default function globalSetup() {
  for (const name of ['DATABASE_URL', 'E2E_EMAIL', 'E2E_PASSWORD']) {
    if (!process.env[name]) throw new Error(`${name} must be set for end-to-end tests`);
  }
  const output = execFileSync(
    'pnpm',
    ['--silent', '--filter', '@ailab/api', 'token', '--agent', 'E2E agent'],
    {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  const token = /API token[^:]*: (\S+)/.exec(output)?.[1];
  if (!token) throw new Error(`Could not issue an agent token:\n${output}`);
  process.env.E2E_AGENT_TOKEN = token;
}
