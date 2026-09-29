/**
 * The project wiki (docs/wiki), bundled into the app at build time so the Wiki page works offline and
 * in the containers. The files stay the one source: this only reads them.
 */
const files = import.meta.glob('../../../../docs/wiki/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface WikiPage {
  /** The file name without ".md"; "README" is the index. */
  slug: string;
  title: string;
  /** The page without its first heading, which the app shows as the page title. */
  body: string;
}

export const wikiPages: WikiPage[] = Object.entries(files)
  .map(([path, text]) => {
    const slug = path.replace(/^.*\//, '').replace(/\.md$/, '');
    const heading = /^#\s+(.+)$/m.exec(text);
    return {
      slug,
      title: heading?.[1]?.trim() ?? slug,
      body: heading ? text.replace(heading[0], '').trimStart() : text,
    };
  })
  .sort((a, b) => order(a.slug) - order(b.slug));

/** The index first, then pages in the order the index lists them, then any it leaves out. */
function order(slug: string): number {
  if (slug === 'README') return -1;
  const index = Object.entries(files).find(([path]) => path.endsWith('/README.md'))?.[1] ?? '';
  const at = index.indexOf(`(${slug}.md)`);
  return at === -1 ? Number.MAX_SAFE_INTEGER : at;
}

export const wikiPage = (slug: string) => wikiPages.find((p) => p.slug === slug);

const REPO = 'https://github.com/walimmalik/AILaboratory/blob/main/';

/**
 * Where a link in a wiki page goes: another wiki page stays in the app; anything else in the repo
 * (plans, ADRs, architecture docs) opens on GitHub; web links open as they are.
 */
export function wikiHref(
  href: string,
): { page: string; hash?: string } | { external: string } | { anchor: string } {
  if (href.startsWith('#')) return { anchor: href };
  if (/^[a-z]+:/i.test(href)) return { external: href };
  const [path = '', hash] = href.split('#');
  const page = /^([\w-]+)\.md$/.exec(path)?.[1];
  if (page && wikiPage(page)) return { page, ...(hash ? { hash } : {}) };
  // Resolve against docs/wiki/ in the repo.
  const parts = ['docs', 'wiki'];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return { external: `${REPO}${parts.join('/')}${hash ? `#${hash}` : ''}` };
}
