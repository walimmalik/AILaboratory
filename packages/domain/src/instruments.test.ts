import type {
  Configuration,
  EquipmentKindAttributes,
  EquipmentNode,
  InstrumentKindAttributes,
} from '@ailab/schema';
import { describe, expect, it } from 'vitest';
import { type KindInfo, resolveConfiguration } from './instruments.ts';

const mm = (value: string) => ({ value, unit: 'mm' as const });
const uL = (value: string) => ({ value, unit: 'uL' as const });
const deckSlots = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3'];

const flex: InstrumentKindAttributes = {
  category: 'liquid_handler',
  performedBy: 'machine',
  mounts: [
    {
      id: 'pipettes',
      label: 'pipette mounts',
      layout: { layout: 'slots', slots: ['left', 'right'] },
      accepts: ['flex_pipette'],
      changedBy: 'operator',
      changeTime: { value: '10', unit: 'min' },
    },
    {
      id: 'gripper',
      label: 'gripper mount',
      layout: { layout: 'fixed' },
      accepts: ['flex_gripper'],
      changedBy: 'operator',
    },
    {
      id: 'deck',
      label: 'deck',
      layout: { layout: 'slots', slots: deckSlots },
      accepts: ['flex_module'],
      changedBy: 'operator',
    },
  ],
  sites: deckSlots.map((slot) => ({ id: slot, mount: { mount: 'deck', slot } })),
};

const star: InstrumentKindAttributes = {
  category: 'liquid_handler',
  performedBy: 'machine',
  mounts: [
    {
      id: 'tracks',
      label: 'deck tracks',
      layout: { layout: 'rail', tracks: 54, pitch: mm('22.5') },
      accepts: ['hamilton_track'],
      changedBy: 'operator',
    },
  ],
};

const kind = (label: string, attributes: EquipmentKindAttributes, confirmed = true) =>
  ({ label, attributes, confirmed }) satisfies KindInfo<EquipmentKindAttributes>;

const id = (n: number) => `eqk_01J9Z3K8Q4ABCDEFGHJKMNPQR${n}`;
const K = {
  eight: id(1),
  ninetySix: id(2),
  thermocycler: id(3),
  heaterShaker: id(4),
  gripper: id(5),
  carrier: id(6),
  adapter: id(7),
};

const equipment = new Map<string, KindInfo<EquipmentKindAttributes>>([
  [
    K.eight,
    kind('Flex 8-Channel 1000 uL', {
      role: 'pipette',
      fits: ['flex_pipette'],
      serialized: true,
      capabilities: [
        {
          capability: 'transfer',
          limits: { volume: { min: uL('5'), max: uL('1000') }, channels: [1, 8] },
        },
      ],
    }),
  ],
  [
    K.ninetySix,
    kind('Flex 96-Channel 1000 uL', {
      role: 'pipette',
      fits: ['flex_pipette'],
      serialized: true,
      placement: { slots: ['left'], alsoClaims: { left: ['right'] } },
      capabilities: [{ capability: 'transfer', limits: { channels: [1, 8, 96] } }],
    }),
  ],
  [
    K.thermocycler,
    kind('Thermocycler Module GEN2', {
      role: 'module',
      fits: ['flex_module'],
      serialized: true,
      placement: { slots: ['B1'], alsoClaims: { B1: ['A1'] } },
      sites: [{ id: 'block', label: 'block' }],
      capabilities: [{ capability: 'thermocycle', sites: ['block'] }],
    }),
  ],
  [
    K.heaterShaker,
    kind('Heater-Shaker Module GEN1', {
      role: 'module',
      fits: ['flex_module'],
      serialized: true,
      mounts: [
        {
          id: 'adapter',
          label: 'adapter mount',
          layout: { layout: 'fixed' },
          accepts: ['hs_adapter'],
          changedBy: 'operator',
        },
      ],
      sites: [{ id: 'plate', label: 'plate', mount: { mount: 'adapter' } }],
      capabilities: [{ capability: 'heat' }, { capability: 'shake' }],
    }),
  ],
  [
    K.gripper,
    kind('Flex Gripper GEN1', {
      role: 'gripper',
      fits: ['flex_gripper'],
      serialized: true,
      capabilities: [{ capability: 'move_labware' }],
    }),
  ],
  [
    K.carrier,
    kind('PLT_CAR_L5AC', {
      role: 'carrier',
      fits: ['hamilton_track'],
      serialized: false,
      placement: { tracks: 6 },
      sites: ['1', '2', '3', '4', '5'].map((position) => ({
        id: position,
        label: `position ${position}`,
      })),
    }),
  ],
  [
    K.adapter,
    kind(
      'Universal Flat Adapter',
      {
        role: 'adapter',
        fits: ['hs_adapter'],
        serialized: false,
        sites: [{ id: 'plate', label: 'plate' }],
      },
      false,
    ),
  ],
]);

const node = (
  nodeId: string,
  kindId: string,
  mount: string,
  placement: EquipmentNode['placement'],
  parent?: string,
): EquipmentNode => ({ id: nodeId, kind: kindId, mount, placement, ...(parent ? { parent } : {}) });
const slot = (s: string) => ({ on: 'slot' as const, slot: s });

const resolve = (
  attributes: InstrumentKindAttributes,
  nodes: EquipmentNode[],
): ReturnType<typeof resolveConfiguration> =>
  resolveConfiguration({
    instrument: { label: 'Flex 1', attributes, confirmed: true },
    equipment,
    configuration: { equipment: nodes } satisfies Configuration,
  });

const rules = (result: ReturnType<typeof resolveConfiguration>) =>
  result.issues.filter((i) => i.severity === 'error').map((i) => [i.rule, i.node]);

describe('resolveConfiguration: Flex', () => {
  const standard = [
    node('left', K.eight, 'pipettes', slot('left')),
    node('gripper', K.gripper, 'gripper', { on: 'fixed' }),
    node('tc', K.thermocycler, 'deck', slot('B1')),
    node('hs', K.heaterShaker, 'deck', slot('D1')),
  ];

  it('works out claims, sites and capabilities', () => {
    const result = resolve(flex, standard);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.claims.find((c) => c.node === 'tc')?.slots).toEqual(['B1', 'A1']);
    const sites = result.sites.map((s) => `${s.node}:${s.site}`);
    // Deck slots under the thermocycler and heater-shaker are covered; theirs appear instead.
    expect(sites).not.toContain('instrument:A1');
    expect(sites).not.toContain('instrument:B1');
    expect(sites).not.toContain('instrument:D1');
    expect(sites).toContain('instrument:C2');
    expect(sites).toContain('tc:block');
    expect(sites).toContain('hs:plate');
    expect(result.sites.find((s) => s.node === 'tc')?.label).toBe('Thermocycler Module GEN2 block');
    expect(result.capabilities.map((c) => c.capability).sort()).toEqual(
      ['heat', 'move_labware', 'shake', 'thermocycle', 'transfer'].sort(),
    );
    expect(result.capabilities.find((c) => c.capability === 'transfer')?.limits?.channels).toEqual([
      1, 8,
    ]);
  });

  it('has no gripper capability when no gripper is installed', () => {
    const result = resolve(
      flex,
      standard.filter((n) => n.id !== 'gripper'),
    );
    expect(result.capabilities.map((c) => c.capability)).not.toContain('move_labware');
  });

  it('refuses a 96-channel pipette next to another pipette', () => {
    const result = resolve(flex, [
      node('head', K.ninetySix, 'pipettes', slot('left')),
      node('right', K.eight, 'pipettes', slot('right')),
    ]);
    expect(result.valid).toBe(false);
    expect(rules(result)).toEqual([['conflict', 'right']]);
    expect(result.issues[0]?.message).toContain('overlaps Flex 96-Channel 1000 uL');
  });

  it('keeps modules to their slots and out of each other', () => {
    expect(rules(resolve(flex, [node('tc', K.thermocycler, 'deck', slot('C1'))]))).toEqual([
      ['slot_not_allowed', 'tc'],
    ]);
    expect(
      rules(
        resolve(flex, [
          node('tc', K.thermocycler, 'deck', slot('B1')),
          node('hs', K.heaterShaker, 'deck', slot('A1')),
        ]),
      ),
    ).toEqual([['conflict', 'hs']]);
  });

  it('refuses equipment on the wrong mount or in the wrong kind of place', () => {
    expect(rules(resolve(flex, [node('hs', K.heaterShaker, 'pipettes', slot('left'))]))).toEqual([
      ['not_accepted', 'hs'],
    ]);
    expect(
      rules(resolve(flex, [node('hs', K.heaterShaker, 'deck', { on: 'rail', track: 3 })])),
    ).toEqual([['wrong_placement', 'hs']]);
    expect(rules(resolve(flex, [node('hs', K.heaterShaker, 'deck', slot('E5'))]))).toEqual([
      ['unknown_slot', 'hs'],
    ]);
    expect(rules(resolve(flex, [node('hs', K.heaterShaker, 'bench', slot('D1'))]))).toEqual([
      ['unknown_mount', 'hs'],
    ]);
  });

  it('nests an adapter on a module and covers the module plate site', () => {
    const result = resolve(flex, [
      node('hs', K.heaterShaker, 'deck', slot('D1')),
      node('flat', K.adapter, 'adapter', { on: 'fixed' }, 'hs'),
    ]);
    expect(result.valid).toBe(true);
    const sites = result.sites.map((s) => `${s.node}:${s.site}`);
    expect(sites).toContain('flat:plate');
    expect(sites).not.toContain('hs:plate');
    // The adapter kind is a draft: a warning, not an error.
    expect(result.issues).toEqual([
      expect.objectContaining({ rule: 'kind_not_confirmed', severity: 'warning', node: 'flat' }),
    ]);
  });

  it('does not place what hangs from equipment that failed', () => {
    const result = resolve(flex, [
      node('hs', K.heaterShaker, 'deck', slot('Z9')),
      node('flat', K.adapter, 'adapter', { on: 'fixed' }, 'hs'),
    ]);
    expect(rules(result)).toEqual([['unknown_slot', 'hs']]);
    expect(result.sites.some((s) => s.node === 'flat' || s.node === 'hs')).toBe(false);
    expect(result.claims.some((c) => c.node === 'flat')).toBe(false);
  });

  it('reports duplicate ids, unknown kinds, unknown parents and cycles', () => {
    const result = resolve(flex, [
      node('left', K.eight, 'pipettes', slot('left')),
      node('left', K.eight, 'pipettes', slot('right')),
      node('ghost', id(9), 'deck', slot('C3')),
      node('orphan', K.adapter, 'adapter', { on: 'fixed' }, 'nowhere'),
      node('a', K.adapter, 'adapter', { on: 'fixed' }, 'b'),
      node('b', K.adapter, 'adapter', { on: 'fixed' }, 'a'),
    ]);
    expect(rules(result)).toEqual([
      ['duplicate_node', 'left'],
      ['unknown_kind', 'ghost'],
      ['unknown_parent', 'orphan'],
      ['cycle', 'a'],
      ['cycle', 'b'],
    ]);
  });
});

describe('resolveConfiguration: STAR', () => {
  it('places carriers on tracks and gives their positions', () => {
    const result = resolve(star, [
      node('c1', K.carrier, 'tracks', { on: 'rail', track: 1 }),
      node('c2', K.carrier, 'tracks', { on: 'rail', track: 7 }),
    ]);
    expect(result.valid).toBe(true);
    expect(result.claims.map((c) => c.tracks)).toEqual([
      { from: 1, to: 6 },
      { from: 7, to: 12 },
    ]);
    expect(result.sites).toHaveLength(10);
    expect(result.sites[0]?.label).toBe('PLT_CAR_L5AC position 1');
  });

  it('refuses overlapping carriers and carriers past the last track', () => {
    const result = resolve(star, [
      node('c1', K.carrier, 'tracks', { on: 'rail', track: 7 }),
      node('c2', K.carrier, 'tracks', { on: 'rail', track: 10 }),
      node('c3', K.carrier, 'tracks', { on: 'rail', track: 50 }),
    ]);
    expect(rules(result)).toEqual([
      ['conflict', 'c2'],
      ['off_rail', 'c3'],
    ]);
    expect(result.issues.find((i) => i.rule === 'off_rail')?.message).toContain('tracks 50 to 55');
  });

  it('refuses a start track on a slot mount', () => {
    expect(rules(resolve(star, [node('c1', K.carrier, 'tracks', slot('A1'))]))).toEqual([
      ['wrong_placement', 'c1'],
    ]);
  });
});
