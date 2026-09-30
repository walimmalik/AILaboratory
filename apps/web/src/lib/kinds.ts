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
  path:
    | '/labware'
    | '/instruments'
    | '/instrument-models'
    | '/equipment'
    | '/reagents'
    | '/lots'
    | '/liquid-classes'
    | '/liquid-types'
    | '/vendors';
  /** The menu group it sits in: one per registry. */
  group: 'Library' | 'Instruments' | 'Reagents';
}

export const libraryPages: KindPage[] = [
  {
    kind: 'labware_type',
    title: 'Labware',
    noun: 'labware type',
    path: '/labware',
    group: 'Library',
  },
  { kind: 'vendor', title: 'Vendors', noun: 'vendor', path: '/vendors', group: 'Library' },
  {
    kind: 'instrument',
    title: 'Instruments',
    noun: 'instrument',
    path: '/instruments',
    group: 'Instruments',
  },
  {
    kind: 'instrument_kind',
    title: 'Instrument models',
    noun: 'instrument model',
    path: '/instrument-models',
    group: 'Instruments',
  },
  {
    kind: 'equipment_kind',
    title: 'Equipment',
    noun: 'equipment kind',
    path: '/equipment',
    group: 'Instruments',
  },
  { kind: 'product', title: 'Reagents', noun: 'product', path: '/reagents', group: 'Reagents' },
  { kind: 'lot', title: 'Lots', noun: 'lot', path: '/lots', group: 'Reagents' },
  {
    kind: 'liquid_class',
    title: 'Liquid classes',
    noun: 'liquid class',
    path: '/liquid-classes',
    group: 'Reagents',
  },
  {
    kind: 'liquid_type',
    title: 'Liquid types',
    noun: 'liquid type',
    path: '/liquid-types',
    group: 'Reagents',
  },
];

/** The menu groups in order, each with its pages. */
export const libraryGroups = (['Library', 'Instruments', 'Reagents'] as const).map((group) => ({
  group,
  pages: libraryPages.filter((p) => p.group === group),
}));

export function kindPage(kind: string): KindPage | undefined {
  return libraryPages.find((p) => p.kind === kind);
}

/** A kind in words: "labware type", "vendor", or the kind with spaces for kinds without a page. */
export function kindNoun(kind: string): string {
  return kindPage(kind)?.noun ?? kind.replaceAll('_', ' ');
}
