import { isDeepStrictEqual } from 'node:util';
import {
  type CapabilityProvider,
  capabilityCatalog,
  defineKind,
  EquipmentItemAttributes,
  EquipmentKindAttributes,
  InstrumentAttributes,
  InstrumentKindAttributes,
  type KindCheck,
  type MountDefinition,
  type SiteDefinition,
} from '@ailab/schema';
import { findOf, resolveWith } from './resolve.ts';
import { workcell } from './workcell-kind.ts';

const LIBRARY = 'Instrument library (plan 008)';

/** What instrument and equipment kinds share: mounts, sites and capability providers. */
interface Parts {
  mounts?: MountDefinition[] | undefined;
  sites?: SiteDefinition[] | undefined;
  capabilities?: CapabilityProvider[] | undefined;
  manufacturer?: string | undefined;
  model?: string | undefined;
}

const duplicates = (ids: string[]) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

function partsChecks<A extends Parts>(capabilitiesSection: string): KindCheck<A>[] {
  return [
    {
      id: 'mounts_consistent',
      label: 'Mounts and their slots have unique names',
      severity: 'blocker',
      source: `${LIBRARY}: configurations name a mount and a slot`,
      section: 'layout',
      fix: 'Rename the repeated mount or slot',
      test: (a) => {
        const mounts = a.mounts ?? [];
        const repeated = duplicates(mounts.map((m) => m.id));
        if (repeated.length > 0) return `Mount ${repeated.join(', ')} appears twice`;
        for (const m of mounts) {
          if (m.layout.layout !== 'slots') continue;
          const slots = duplicates(m.layout.slots);
          if (slots.length > 0) return `The ${m.label} lists ${slots.join(', ')} twice`;
        }
        return true;
      },
    },
    {
      id: 'sites_consistent',
      label: 'Sites have unique names and sit on real mounts',
      severity: 'blocker',
      source: `${LIBRARY}: labware placement names a site`,
      section: 'layout',
      fix: 'Rename the repeated site, or point it at a mount and slot that exist',
      test: (a) => {
        const sites = a.sites ?? [];
        const repeated = duplicates(sites.map((s) => s.id));
        if (repeated.length > 0) return `Site ${repeated.join(', ')} appears twice`;
        for (const site of sites) {
          if (!site.mount) continue;
          const mount = a.mounts?.find((m) => m.id === site.mount?.mount);
          if (!mount)
            return `Site ${site.id} sits on mount "${site.mount.mount}", which isn't listed`;
          const { slot } = site.mount;
          if (slot && (mount.layout.layout !== 'slots' || !mount.layout.slots.includes(slot))) {
            return `Site ${site.id} sits on slot ${slot}, which the ${mount.label} doesn't have`;
          }
        }
        return true;
      },
    },
    {
      id: 'capability_sites_exist',
      label: 'Capabilities happen at listed sites',
      severity: 'blocker',
      source: LIBRARY,
      section: capabilitiesSection,
      fix: 'Name sites from the site list, or leave the capability without sites',
      test: (a) => {
        const ids = new Set((a.sites ?? []).map((s) => s.id));
        for (const p of a.capabilities ?? []) {
          const missing = (p.sites ?? []).filter((s) => !ids.has(s));
          if (missing.length > 0)
            return `${p.capability} names site ${missing.join(', ')}, which isn't listed`;
        }
        return true;
      },
    },
    {
      id: 'limits_known',
      label: 'Capability limits are known',
      severity: 'warning',
      source: `${LIBRARY}: the scheduler and designers pick instruments by their limits`,
      section: capabilitiesSection,
      fix: 'Add the limits from the datasheet (the capability catalog says which each one needs)',
      test: (a) => {
        const gaps = (a.capabilities ?? []).flatMap((p) => {
          const missing = capabilityCatalog[p.capability].expects.filter(
            (key) => p.limits?.[key] === undefined,
          );
          return missing.length > 0 ? [`${p.capability} (${missing.join(', ')})`] : [];
        });
        return gaps.length === 0 || `Missing limits: ${gaps.join('; ')}`;
      },
    },
    {
      id: 'model_known',
      label: 'Manufacturer and model are known',
      severity: 'warning',
      source: `${LIBRARY}: needed to match it to a datasheet and to service`,
      section: 'identity',
      fix: 'Add the manufacturer and model',
      test: (a) => (a.manufacturer && a.model ? true : 'Manufacturer or model is missing'),
    },
  ];
}

const instrumentChecks: KindCheck<InstrumentKindAttributes>[] = [
  ...partsChecks<InstrumentKindAttributes>('capabilities'),
  {
    id: 'does_something',
    label: 'It can do something',
    severity: 'warning',
    source: `${LIBRARY}: digital SOP steps bind to capabilities`,
    section: 'capabilities',
    fix: 'List its capabilities, or the mounts for the equipment that brings them',
    test: (a) =>
      (a.capabilities?.length ?? 0) > 0 ||
      (a.mounts?.length ?? 0) > 0 ||
      'No capabilities and no mounts',
  },
  {
    id: 'manual_by_person',
    label: 'Manual stations are worked by a person',
    severity: 'warning',
    source: `${LIBRARY}: the scheduler books an operator for manual work`,
    section: 'identity',
    fix: 'Set "performed by" to person, or choose another category',
    test: (a) =>
      a.category !== 'manual_station' ||
      a.performedBy === 'person' ||
      'A manual station set to machine',
  },
];

const equipmentChecks: KindCheck<EquipmentKindAttributes>[] = [
  ...partsChecks<EquipmentKindAttributes>('capabilities'),
  {
    id: 'placement_consistent',
    label: 'Extra slots follow the allowed slots',
    severity: 'blocker',
    source: `${LIBRARY}: the resolver works out what equipment takes up`,
    section: 'layout',
    fix: 'Only give extra slots for slots it may go in',
    test: (a) => {
      const allowed = a.placement?.slots;
      const keys = Object.keys(a.placement?.alsoClaims ?? {});
      const stray = allowed ? keys.filter((k) => !allowed.includes(k)) : [];
      return stray.length === 0 || `Extra slots given for ${stray.join(', ')}, where it can't go`;
    },
  },
  {
    id: 'does_something',
    label: 'It adds something',
    severity: 'warning',
    source: LIBRARY,
    section: 'capabilities',
    fix: 'List what it can do, the sites it offers, or its mounts',
    test: (a) =>
      (a.capabilities?.length ?? 0) + (a.sites?.length ?? 0) + (a.mounts?.length ?? 0) > 0 ||
      'No capabilities, sites or mounts',
  },
];

const madeBy = (a: { manufacturer?: string | undefined }) =>
  a.manufacturer ? [{ toId: a.manufacturer, relation: 'made_by' }] : [];

/** An instrument kind (ADR 0025): a model like the Hamilton STAR, or a manual station. */
export const instrumentKind = defineKind({
  kind: 'instrument_kind',
  idPrefix: 'ink',
  namePrefix: 'INK',
  nameWidth: 4,
  attributes: InstrumentKindAttributes,
  links: madeBy,
  sections: [
    {
      id: 'identity',
      title: 'Identity',
      fields: [
        'manufacturer',
        'model',
        'variants',
        'category',
        'performedBy',
        'footprint',
        'weight',
        'controlInterfaces',
        'twin',
        'notes',
      ],
    },
    { id: 'layout', title: 'Mounts and sites', fields: ['mounts', 'sites'] },
    { id: 'capabilities', title: 'Capabilities', fields: ['capabilities'] },
  ],
  checks: instrumentChecks,
  notApplicable: (a) => (a.performedBy === 'person' ? ['twin', 'controlInterfaces'] : []),
});

/** An equipment kind (ADR 0025): a pipette, head, gripper, module, carrier or adapter. */
export const equipmentKind = defineKind({
  kind: 'equipment_kind',
  idPrefix: 'eqk',
  namePrefix: 'EQK',
  nameWidth: 4,
  attributes: EquipmentKindAttributes,
  links: madeBy,
  sections: [
    {
      id: 'identity',
      title: 'Identity',
      fields: ['manufacturer', 'model', 'role', 'serialized', 'notes'],
    },
    {
      id: 'layout',
      title: 'Fit, mounts and sites',
      fields: ['fits', 'placement', 'mounts', 'sites'],
    },
    { id: 'capabilities', title: 'Capabilities', fields: ['capabilities'] },
  ],
  checks: equipmentChecks,
});

const instrumentChecksOnInstance: KindCheck<InstrumentAttributes>[] = [
  {
    id: 'identified',
    label: 'Serial number is known',
    severity: 'warning',
    source: `${LIBRARY}: service, calibration and support go by serial`,
    section: 'identity',
    fix: 'Add the serial from the label on the instrument',
    test: (a) => a.serial !== undefined || 'Not given',
  },
  {
    id: 'calibration_due_known',
    label: 'Next calibration date is known',
    severity: 'warning',
    source: `${LIBRARY}: the scheduler avoids instruments that are due`,
    section: 'service',
    fix: 'Log the last service with the date calibration is next due',
    test: (a) => a.calibrationDue !== undefined || 'Not given',
  },
];

/**
 * A registered instrument (008b): the real machine, with what is installed on it now. Every write
 * resolves its configuration against the kinds (ADR 0041); instruments.change_configuration is the
 * convenient way to change it.
 */
export const instrument = defineKind({
  kind: 'instrument',
  idPrefix: 'ins',
  namePrefix: 'INS',
  nameWidth: 4,
  attributes: InstrumentAttributes,
  links: (a) => [
    { toId: a.kind, relation: 'is_a' },
    ...a.configuration.equipment.flatMap((n) => [
      { toId: n.kind, relation: 'has_equipment' },
      ...(n.item ? [{ toId: n.item, relation: 'has_item' }] : []),
    ]),
  ],
  sections: [
    {
      id: 'identity',
      title: 'Identity',
      fields: ['kind', 'variant', 'shortName', 'serial', 'room', 'notes'],
    },
    { id: 'configuration', title: 'Installed equipment', fields: ['configuration'] },
    {
      id: 'service',
      title: 'Status and service',
      fields: ['status', 'lastService', 'calibrationDue'],
    },
  ],
  checks: instrumentChecksOnInstance,
  related: async (a, { get, list, current }) => {
    const before = current?.attributes as InstrumentAttributes | undefined;
    const changed =
      before?.kind !== a.kind || !isDeepStrictEqual(before.configuration, a.configuration);
    const kind = await findOf({ get, list }, a.kind, 'instrument_kind');
    const errors = kind
      ? (await resolveWith({ get, list }, kind, a.configuration, current?.id)).issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.message)
      : [`${a.kind} is not an instrument kind in this lab`];
    return {
      ...(changed && errors.length > 0
        ? { invalid: [`The configuration doesn't work: ${errors.join('; ')}`] }
        : {}),
      checks: [
        {
          id: 'configuration_resolves',
          label: 'Installed equipment fits the instrument',
          severity: 'blocker',
          source: `${LIBRARY}: mounts, sites and equipment on the kinds`,
          section: 'configuration',
          passed: errors.length === 0,
          ...(errors.length > 0 ? { message: errors.join('; ') } : {}),
          fix: 'Change the installed equipment so every piece has a place it fits',
        },
      ],
    };
  },
});

/** A serial-bearing part that moves between instruments (I4): a Flex pipette, gripper or module. */
export const equipmentItem = defineKind({
  kind: 'equipment_item',
  idPrefix: 'eqp',
  namePrefix: 'EQP',
  nameWidth: 4,
  attributes: EquipmentItemAttributes,
  links: (a) => [{ toId: a.kind, relation: 'is_a' }],
  sections: [
    { id: 'identity', title: 'Identity', fields: ['kind', 'serial', 'calibrationDue', 'notes'] },
  ],
});

export const instrumentKinds = [instrumentKind, equipmentKind, instrument, equipmentItem, workcell];
