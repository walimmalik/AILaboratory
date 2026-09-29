import { parseArgs } from 'node:util';
import { issueToken } from './auth.ts';
import { connect } from './db/client.ts';
import { users } from './db/schema.ts';

/**
 * Issues an API token. With --agent, the token acts as that agent on behalf of the user,
 * for MCP clients such as Claude Code or a bring-your-own-key model.
 *
 *   pnpm --filter @ailab/api token --agent "DeepSeek"
 */
const { values } = parseArgs({
  // npm-style runners may pass a literal "--" through.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { agent: { type: 'string' }, user: { type: 'string' } },
});

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const connection = await connect(url);
const all = await connection.db.select({ id: users.id, name: users.displayName }).from(users);
const user = values.user
  ? all.find((u) => u.id === values.user)
  : all.length === 1
    ? all[0]
    : undefined;
if (!user) {
  console.error(
    all.length === 0
      ? 'No users yet. Run the bootstrap command first.'
      : `Pass --user with one of: ${all.map((u) => `${u.id} (${u.name})`).join(', ')}`,
  );
  await connection.close();
  process.exit(1);
}

const token = await issueToken(connection.db, {
  userId: user.id,
  ...(values.agent ? { agentName: values.agent } : {}),
});
console.log(
  values.agent
    ? `Token for agent "${values.agent}" acting on behalf of ${user.name}.`
    : `Token for ${user.name}.`,
);
console.log(`API token (shown once, keep it private): ${token}`);
await connection.close();
