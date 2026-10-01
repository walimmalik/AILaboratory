/**
 * Every link relation in plain words, from both ends (plan 004f N6, ADR 0063). `from` says what
 * the linked record is to the record holding the link ("sold by" a vendor); `to` says what the
 * records linking here are to this one (a vendor "sells" them). A record's Connections tab groups
 * its links under these words: "Based on" lists `from`, "Used in" lists `to`. A test fails when
 * a kind declares a relation that has no words here.
 */
export const RELATION_WORDS = {
  about: { from: 'about', to: 'subject of' },
  applies_with: { from: 'applies with', to: 'condition of' },
  avoid: { from: 'avoids', to: 'avoided by' },
  cites: { from: 'cites', to: 'cited by' },
  contains: { from: 'contains', to: 'member of set' },
  control: { from: 'uses as a control', to: 'control in' },
  data: { from: 'data file', to: 'data of' },
  derived_from: { from: 'derived from', to: 'source of' },
  digitized_from: { from: 'digitized from', to: 'digitized as' },
  drafted_from: { from: 'drafted from', to: 'example for' },
  evidence: { from: 'concluded from', to: 'evidence for' },
  executes: { from: 'carries out', to: 'carried out by' },
  exported_from: { from: 'exported from', to: 'exported as' },
  fills: { from: 'fills', to: 'filled by' },
  follows: { from: 'follows', to: 'followed by' },
  follows_up: { from: 'follows up', to: 'followed up by' },
  for_device: { from: 'for the device', to: 'liquid classes for it' },
  for_source_plate: { from: 'for the source plate', to: 'liquid classes for it' },
  for_tips: { from: 'for the tips', to: 'liquid classes for them' },
  from_memory: { from: 'from lab memory', to: 'applied in' },
  has_component: { from: 'has component', to: 'component of' },
  has_equipment: { from: 'has installed', to: 'installed on' },
  has_file: { from: 'has file', to: 'file of' },
  has_item: { from: 'has installed', to: 'installed on' },
  held_in: { from: 'held in', to: 'holds' },
  inside: { from: 'inside', to: 'holds' },
  is_a: { from: 'is a', to: 'in the lab as' },
  is_instrument: { from: 'the place of', to: 'its place' },
  learned_from: { from: 'learned from', to: 'lesson in' },
  links_to_kind: { from: 'fields link to', to: 'linked from fields of' },
  lot_of: { from: 'lot of', to: 'lots' },
  made_by: { from: 'made by', to: 'makes' },
  made_from: { from: 'made from', to: 'used to make' },
  made_with: { from: 'makes', to: 'made in' },
  member: { from: 'has member', to: 'member of' },
  part_of: { from: 'part of', to: 'includes' },
  picked_by: { from: 'picked in', to: 'picked set' },
  pipettes_as: { from: 'pipettes as', to: 'liquid type of' },
  places: { from: 'places', to: 'placed on' },
  plate_type: { from: 'on plate type', to: 'plate type in' },
  prefer: { from: 'prefers', to: 'preferred by' },
  published_by: { from: 'published by', to: 'publishes' },
  ran_on: { from: 'ran on', to: 'ran' },
  read_by: { from: 'read by', to: 'reads' },
  references: { from: 'references', to: 'referenced by' },
  refers_to: { from: 'refers to', to: 'referred to by' },
  repeats_with_changes: { from: 'repeats with changes', to: 'repeated with changes by' },
  replaced_by: { from: 'replaced by', to: 'replaces' },
  report: { from: 'from the report', to: 'report of' },
  requires: { from: 'requires', to: 'required by' },
  rerun: { from: 'rerun as', to: 'rerun of' },
  reruns: { from: 'reruns', to: 'rerun by' },
  runs: { from: 'run of', to: 'runs' },
  runs_on: { from: 'runs on', to: 'runs' },
  serves: { from: 'for the liquid', to: 'liquid classes for it' },
  sets: { from: 'sets', to: 'set by' },
  sold_by: { from: 'sold by', to: 'sells' },
  stored_in: { from: 'stored in', to: 'stores' },
  supplied_by: { from: 'supplied by', to: 'supplies' },
  tests: { from: 'tests', to: 'tested in' },
  uses: { from: 'uses', to: 'used by' },
  uses_class: { from: 'uses liquid class', to: 'used by' },
  uses_lot: { from: 'uses lot', to: 'used in' },
  verifies: { from: 'verifies', to: 'verified by' },
} as const satisfies Record<string, { from: string; to: string }>;

export type RelationName = keyof typeof RELATION_WORDS;

/** A relation in words from one end; a relation without words reads as its name in words. */
export function relationWords(relation: string, end: 'from' | 'to'): string {
  const known = (RELATION_WORDS as Record<string, { from: string; to: string }>)[relation];
  return known ? known[end] : relation.replaceAll('_', ' ');
}
