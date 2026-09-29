import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.ts';

export type Schema = typeof schema;
/** Any Drizzle Postgres database with our schema: node-postgres in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function connect(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return {
    db: db as unknown as Db,
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => pool.end(),
  };
}
