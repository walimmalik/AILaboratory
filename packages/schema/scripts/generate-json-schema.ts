import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toJsonSchemas } from '../src/json-schema.ts';

const outDir = join(import.meta.dirname, '..', 'generated');
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(toJsonSchemas())) {
  writeFileSync(join(outDir, `${name}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`);
}
console.log(`wrote JSON Schema to ${outDir}`);
