import { createTenant, issueToken } from './auth.ts';
import { connect } from './db/client.ts';
import { orgs } from './db/schema.ts';

/** First-run setup: migrates, creates the lab and its first user, and prints a token once. */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const connection = await connect(url);
await connection.migrate();
const existing = await connection.db.select({ id: orgs.id }).from(orgs).limit(1);
if (existing.length > 0) {
  console.log('Already bootstrapped. Nothing changed.');
} else {
  const tenant = await createTenant(connection.db, {
    orgName: process.env.BOOTSTRAP_ORG ?? 'My organization',
    labName: process.env.BOOTSTRAP_LAB ?? 'My lab',
    userName: process.env.BOOTSTRAP_USER ?? 'Lab owner',
  });
  const token = await issueToken(connection.db, { userId: tenant.userId });
  console.log(`Created lab ${tenant.labId} and user ${tenant.userId}.`);
  console.log(`API token (shown once, keep it private): ${token}`);
}
await connection.close();
