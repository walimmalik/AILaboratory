import { connect } from './client.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const connection = await connect(url);
await connection.migrate();
await connection.close();
console.log('migrations applied');
