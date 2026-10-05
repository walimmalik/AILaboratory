import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { type Area, areas, type KindPage, libraryPages } from '../lib/kinds.ts';
import { reviewQuery } from '../queries.ts';

/**
 * The head of a page in an area (plan 004f N1): where it is, its title and what it lists, then
 * the area's tabs, one per kind of thing the area lists, each with the drafts waiting in it.
 */
export function Head({
  page,
  lede,
  actions,
}: {
  page: KindPage;
  lede: string;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumbs">
            lab / {page.area !== page.title && <>{page.area.toLowerCase()} / </>}
            <b>{page.title.toLowerCase()}</b>
          </div>
          <h1>{page.title}</h1>
          <p className="lede">{lede}</p>
        </div>
        {actions}
      </div>
      <AreaTabs area={page.area} current={page.under ?? page.kind} />
    </>
  );
}

export function AreaTabs({ area, current }: { area: Area; current?: string }) {
  const drafts = useQuery(reviewQuery).data?.counts.drafts ?? {};
  const tabs = areas.find((a) => a.area === area)?.tabs ?? [];
  return (
    <nav className="tabs area-tabs" aria-label={`${area} tabs`}>
      {area === 'Library' && current && (
        <Link to="/library" className="tab">
          Start here
        </Link>
      )}
      {tabs.map((t) => {
        // A tab counts its own drafts and those of pages that sit under it.
        const waiting = libraryPages
          .filter((p) => p.kind === t.kind || p.under === t.kind)
          .reduce((n, p) => n + (drafts[p.kind] ?? 0), 0);
        return (
          <Link
            key={t.kind}
            to={t.path}
            className={t.kind === current ? 'tab on' : 'tab'}
            aria-current={t.kind === current ? 'page' : undefined}
          >
            {t.title}
            {waiting > 0 && (
              <span className="count agent-ink" title={`${waiting} drafts to review`}>
                {waiting}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** A kind's page in the menu, by kind. */
export const page = (kind: string) => libraryPages.find((p) => p.kind === kind) as KindPage;
