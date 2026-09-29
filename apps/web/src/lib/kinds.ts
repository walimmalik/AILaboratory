/**
 * The library pages in the menu (plan 007b): one per registry, in plain words. Kinds without a page
 * (test kinds, registries still to come) are reached through All records.
 */
export interface KindPage {
  kind: string;
  /** Menu and page title, e.g. "Labware". */
  title: string;
  /** One record in words, e.g. "labware type". */
  noun: string;
  path: '/labware' | '/vendors';
}

export const libraryPages: KindPage[] = [
  { kind: 'labware_type', title: 'Labware', noun: 'labware type', path: '/labware' },
  { kind: 'vendor', title: 'Vendors', noun: 'vendor', path: '/vendors' },
];

export function kindPage(kind: string): KindPage | undefined {
  return libraryPages.find((p) => p.kind === kind);
}

/** A kind in words: "labware type", "vendor", or the kind with spaces for kinds without a page. */
export function kindNoun(kind: string): string {
  return kindPage(kind)?.noun ?? kind.replaceAll('_', ' ');
}
