import { randomBytes } from 'node:crypto';
import { createTenant, issueToken, setPassword } from './auth.ts';
import { connect } from './db/client.ts';
import { orgs } from './db/schema.ts';

/** First-run setup: migrates, creates the lab and its first user, and prints a password and a token once. */
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
  const email = process.env.BOOTSTRAP_EMAIL ?? 'owner@lab.local';
  const password = process.env.BOOTSTRAP_PASSWORD ?? randomBytes(12).toString('base64url');
  await setPassword(connection.db, { userId: tenant.userId, email, password });
  const token = await issueToken(connection.db, { userId: tenant.userId });
  console.log(`Created lab ${tenant.labId} and user ${tenant.userId}.`);
  console.log(`Sign in to the web app as ${email}.`);
  if (!process.env.BOOTSTRAP_PASSWORD) {
    console.log(`Password (shown once, change it with the password command): ${password}`);
  }
  console.log(`API token (shown once, keep it private): ${token}`);
}
await connection.close();
