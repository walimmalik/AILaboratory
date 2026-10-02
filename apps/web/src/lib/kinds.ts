/**
 * The menu (plan 004f N1, ADR 0063): eight entries, four of them areas whose pages are tabs, one
 * per kind of thing the area lists. Each tab keeps its own path, so old links open the tab. Kinds
 * without a tab (test kinds, kinds still to come) are reached through All records.
 */
export type Area = 'Experiments' | 'Inventory' | 'Instruments' | 'Library';

export interface KindPage {
  kind: string;
  /** Tab and page title, e.g. "Labware". */
  title: string;
  /** One record in words, e.g. "labware type". */
  noun: string;
  path:
    | '/labware'
    | '/instruments'
    | '/instrument-models'
    | '/equipment'
    | '/workcells'
    | '/reagents'
    | '/lots'
    | '/liquid-classes'
    | '/liquid-types'
    | '/vendors'
    | '/containers'
    | '/places'
    | '/samples'
    | '/entities'
    | '/entity-kinds'
    | '/documents'
    | '/sops'
    | '/campaigns'
    | '/experiments'
    | '/runs'
    | '/sets'
    | '/plate-maps'
    | '/layouts'
    | '/memory';
  /** The menu entry whose tabs it sits in. */
  area: Area;
  /** A page without a tab of its own names the tab it belongs under (plate maps under layouts, N5). */
  under?: string;
}

/** Every kind page, in tab order within each area. */
export const libraryPages: KindPage[] = [
  {
    kind: 'experiment',
    title: 'Experiments',
    noun: 'experiment',
    path: '/experiments',
    area: 'Experiments',
  },
  {
    kind: 'campaign',
    title: 'Campaigns',
    noun: 'campaign',
    path: '/campaigns',
    area: 'Experiments',
  },
  { kind: 'run', title: 'Runs', noun: 'run', path: '/runs', area: 'Experiments' },
  { kind: 'set', title: 'Sets', noun: 'set', path: '/sets', area: 'Experiments' },
  { kind: 'product', title: 'Reagents', noun: 'product', path: '/reagents', area: 'Inventory' },
  { kind: 'lot', title: 'Lots', noun: 'lot', path: '/lots', area: 'Inventory' },
  { kind: 'entity', title: 'Materials', noun: 'material', path: '/entities', area: 'Inventory' },
  { kind: 'sample', title: 'Samples', noun: 'sample', path: '/samples', area: 'Inventory' },
  {
    kind: 'container',
    title: 'Containers',
    noun: 'container',
    path: '/containers',
    area: 'Inventory',
  },
  { kind: 'location', title: 'Places', noun: 'place', path: '/places', area: 'Inventory' },
  {
    kind: 'instrument',
    title: 'Instruments',
    noun: 'instrument',
    path: '/instruments',
    area: 'Instruments',
  },
  {
    kind: 'instrument_kind',
    title: 'Instrument models',
    noun: 'instrument model',
    path: '/instrument-models',
    area: 'Instruments',
  },
  {
    kind: 'workcell',
    title: 'Workcells',
    noun: 'workcell',
    path: '/workcells',
    area: 'Instruments',
  },
  {
    kind: 'equipment_kind',
    title: 'Equipment',
    noun: 'equipment kind',
    path: '/equipment',
    area: 'Instruments',
  },
  { kind: 'sop', title: 'SOPs', noun: 'SOP', path: '/sops', area: 'Library' },
  { kind: 'document', title: 'Documents', noun: 'document', path: '/documents', area: 'Library' },
  { kind: 'memory', title: 'Lab memory', noun: 'lab memory', path: '/memory', area: 'Library' },
  {
    kind: 'labware_type',
    title: 'Labware',
    noun: 'labware type',
    path: '/labware',
    area: 'Library',
  },
  { kind: 'layout', title: 'Plate layouts', noun: 'layout', path: '/layouts', area: 'Library' },
  {
    kind: 'plate_map',
    title: 'Plate maps',
    noun: 'plate map',
    path: '/plate-maps',
    area: 'Library',
    under: 'layout',
  },
  {
    kind: 'liquid_class',
    title: 'Liquid classes',
    noun: 'liquid class',
    path: '/liquid-classes',
    area: 'Library',
  },
  {
    kind: 'liquid_type',
    title: 'Liquid types',
    noun: 'liquid type',
    path: '/liquid-types',
    area: 'Library',
  },
  {
    kind: 'entity_kind',
    title: 'Material kinds',
    noun: 'material kind',
    path: '/entity-kinds',
    area: 'Library',
  },
  { kind: 'vendor', title: 'Vendors', noun: 'vendor', path: '/vendors', area: 'Library' },
];

/** The four areas in menu order, each with its tabs (pages that sit under another tab left out). */
export const areas = (['Experiments', 'Inventory', 'Instruments', 'Library'] as const).map(
  (area) => ({
    area,
    tabs: libraryPages.filter((p) => p.area === area && !p.under),
    kinds: libraryPages.filter((p) => p.area === area).map((p) => p.kind),
  }),
);

export function kindPage(kind: string): KindPage | undefined {
  return libraryPages.find((p) => p.kind === kind);
}

/** A kind in words: "labware type", "vendor", or the kind with spaces for kinds without a page. */
export function kindNoun(kind: string): string {
  return kindPage(kind)?.noun ?? kind.replaceAll('_', ' ');
}
