import { Link, useParams } from '@tanstack/react-router';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { wikiHref, wikiPage, wikiPages } from '../lib/wiki.ts';

/** The project wiki, read-only: the rules, decisions, roadmap and data model in plain words. */
export function WikiPage() {
  const { page: slug = 'README' } = useParams({ strict: false }) as { page?: string };
  const page = wikiPage(slug);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab /{' '}
            {slug === 'README' ? (
              <b>wiki</b>
            ) : (
              <>
                <Link to="/wiki">wiki</Link> / <b>{slug}</b>
              </>
            )}
          </div>
          <h1>{page?.title ?? 'Not found'}</h1>
        </div>
      </div>
      <nav className="wiki-pages" aria-label="Wiki pages">
        {wikiPages.map((p) => (
          <Link
            key={p.slug}
            to={p.slug === 'README' ? '/wiki' : '/wiki/$page'}
            params={p.slug === 'README' ? {} : { page: p.slug }}
            aria-current={p.slug === slug ? 'page' : undefined}
          >
            {p.slug === 'README' ? 'Contents' : p.title.replace(/ and .*/, '')}
          </Link>
        ))}
      </nav>
      <article className="block wiki" aria-label={page?.title ?? 'Wiki'}>
        <div className="body">
          {page ? (
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href = '', children }) => {
                  const target = wikiHref(href);
                  if ('page' in target) {
                    return (
                      <Link
                        to="/wiki/$page"
                        params={{ page: target.page }}
                        {...(target.hash ? { hash: target.hash } : {})}
                      >
                        {children}
                      </Link>
                    );
                  }
                  if ('anchor' in target) return <a href={target.anchor}>{children}</a>;
                  return (
                    <a href={target.external} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  );
                },
                table: ({ children }) => (
                  <div className="table-wrap">
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {page.body}
            </Markdown>
          ) : (
            <p className="empty">
              There is no wiki page called “{slug}”. <Link to="/wiki">See all pages</Link>.
            </p>
          )}
        </div>
      </article>
    </>
  );
}
