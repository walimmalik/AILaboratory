import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bundles the repo's skills (skills/<module>/SKILL.md) into the API, so `skills.list`, `skills.get`
 * and the MCP skill resources serve them from the container too (plan 004e R7, ADR 0054). The
 * Markdown files stay the one source; CI fails when this copy is stale.
 */
const root = join(import.meta.dirname, '..', '..', '..', 'skills');
const out = join(import.meta.dirname, '..', 'src', 'skills', 'skills.generated.json');

const skills = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((module) => {
    const text = readFileSync(join(root, module, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!front) throw new Error(`skills/${module}/SKILL.md has no front matter`);
    const field = (key: string) =>
      new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(front[1] ?? '')?.[1]?.trim() ?? '';
    return {
      module,
      name: field('name'),
      description: field('description'),
      text: text.slice(front[0].length).trimStart(),
    };
  });

writeFileSync(out, `${JSON.stringify(skills, null, 2)}\n`);
console.log(`wrote ${skills.length} skills to ${out}`);
