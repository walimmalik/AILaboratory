import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { setPassword } from './auth.ts';
import { connect } from './db/client.ts';
import { users } from './db/schema.ts';

/**
 * Sets the web sign-in email and password for a user. Without --password, a random one is generated
 * and printed once.
 *
 *   pnpm --filter @ailab/api password --email you@lab.org
 */
const { values } = parseArgs({
  // npm-style runners may pass a literal "--" through.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { email: { type: 'string' }, password: { type: 'string' }, user: { type: 'string' } },
});

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const connection = await connect(url);
const all = await connection.db
  .select({ id: users.id, name: users.displayName, email: users.email })
  .from(users);
const user = values.user
  ? all.find((u) => u.id === values.user)
  : all.length === 1
    ? all[0]
    : undefined;
const email = values.email ?? user?.email ?? undefined;
if (!user || !email) {
  console.error(
    all.length === 0
      ? 'No users yet. Run the bootstrap command first.'
      : !user
        ? `Pass --user with one of: ${all.map((u) => `${u.id} (${u.name})`).join(', ')}`
        : 'Pass --email with the address to sign in with.',
  );
  await connection.close();
  process.exit(1);
}

const password = values.password ?? randomBytes(12).toString('base64url');
await setPassword(connection.db, { userId: user.id, email, password });
console.log(`Sign in as ${email.trim().toLowerCase()}.`);
if (!values.password) console.log(`Password (shown once): ${password}`);
await connection.close();
