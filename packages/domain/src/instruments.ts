import {
  type Configuration as ConfigurationInput,
  type ConfigurationIssue,
  type EquipmentKindAttributes,
  type EquipmentNode,
  type InstrumentKindAttributes,
  type MountDefinition,
  type ResolvedConfiguration,
  ROOT_NODE,
  type SiteDefinition,
} from '@ailab/schema';

/**
 * Resolving an instrument configuration (plan 008, after echo650-twin's CONFIGURATION_MODEL): from
 * the instrument kind and the equipment on its mounts, work out what each piece takes up, where
 * labware can sit and what the instrument can do. The result is derived, never edited.
 */

export interface KindInfo<A> {
  label: string;
  attributes: A;
  /** A kind nobody has confirmed yet gives a warning: its values may still be wrong. */
  confirmed: boolean;
}

export interface ResolveInput {
  instrument: KindInfo<InstrumentKindAttributes>;
  /** The equipment kinds the configuration names, by record ID. */
  equipment: ReadonlyMap<string, KindInfo<EquipmentKindAttributes>>;
  configuration: ConfigurationInput;
  /**
   * The equipment items the configuration names, by record ID: their kind, and the instrument they
   * are installed in when that is another one. Items not given are unknown.
   */
  items?: ReadonlyMap<string, ItemInfo>;
}

export interface ItemInfo {
  label: string;
  kind: string;
  /** The other instrument it is installed in, in words, e.g. "Flex 2 (INS-0002)". */
  installedIn?: string;
}

type Resolved = ResolvedConfiguration;

interface Holder {
  label: string;
  mounts: MountDefinition[];
  sites: SiteDefinition[];
}

const placeWords = (node: EquipmentNode) =>
  node.placement.on === 'slot'
    ? `slot ${node.placement.slot}`
    : node.placement.on === 'rail'
      ? `track ${node.placement.track}`
      : 'its mount';

export function resolveConfiguration({
  instrument,
  equipment,
  configuration,
  items,
}: ResolveInput): Resolved {
  const issues: ConfigurationIssue[] = [];
  const error = (rule: ConfigurationIssue['rule'], node: string | undefined, message: string) =>
    issues.push({ rule, severity: 'error', ...(node ? { node } : {}), message });

  if (!instrument.confirmed) {
    issues.push({
      rule: 'kind_not_confirmed',
      severity: 'warning',
      message: `${instrument.label} is a draft nobody has confirmed yet`,
    });
  }

  // Nodes by id; the instrument itself is the root.
  const nodes = new Map<string, EquipmentNode>();
  for (const node of configuration.equipment) {
    if (node.id === ROOT_NODE || nodes.has(node.id)) {
      error('duplicate_node', node.id, `Two pieces of equipment are both called "${node.id}"`);
      continue;
    }
    nodes.set(node.id, node);
  }

  const holders = new Map<string, Holder>([
    [
      ROOT_NODE,
      {
        label: instrument.label,
        mounts: instrument.attributes.mounts ?? [],
        sites: instrument.attributes.sites ?? [],
      },
    ],
  ]);
  const labelOf = (node: EquipmentNode) => node.label ?? equipment.get(node.kind)?.label ?? node.id;
  const warned = new Set<string>();
  const itemUsed = new Map<string, string>(); // item ID -> node ID
  for (const node of nodes.values()) {
    const kind = equipment.get(node.kind);
    if (!kind) {
      error(
        'unknown_kind',
        node.id,
        `${node.id}: ${node.kind} is not an equipment kind in this lab`,
      );
      continue;
    }
    if (!kind.confirmed && !warned.has(node.kind)) {
      warned.add(node.kind);
      issues.push({
        rule: 'kind_not_confirmed',
        severity: 'warning',
        node: node.id,
        message: `${kind.label} is a draft nobody has confirmed yet`,
      });
    }
    if (node.item) {
      const item = items?.get(node.item);
      const problem = !item
        ? `${node.item} is not an equipment item in this lab`
        : item.kind !== node.kind
          ? `${item.label} is not a ${kind.label}`
          : itemUsed.has(node.item)
            ? `${item.label} is also "${itemUsed.get(node.item)}" in this configuration`
            : item.installedIn
              ? `${item.label} is installed in ${item.installedIn}`
              : undefined;
      if (problem) {
        error('wrong_item', node.id, problem);
        continue;
      }
      itemUsed.set(node.item, node.id);
    }
    holders.set(node.id, {
      label: labelOf(node),
      mounts: kind.attributes.mounts ?? [],
      sites: kind.attributes.sites ?? [],
    });
  }

  // Parents and cycles. A node is placed only when it and everything it hangs from resolve.
  const failed = new Set<string>(
    [...nodes.keys()].filter((id) => !holders.has(id)), // unknown kinds
  );
  for (const node of nodes.values()) {
    const parent = node.parent ?? ROOT_NODE;
    if (parent !== ROOT_NODE && !nodes.has(parent)) {
      error(
        'unknown_parent',
        node.id,
        `${labelOf(node)} hangs from "${parent}", which is not in the configuration`,
      );
      failed.add(node.id);
      continue;
    }
    const seen = new Set([node.id]);
    for (let at = nodes.get(parent); at; at = nodes.get(at.parent ?? ROOT_NODE)) {
      if (seen.has(at.id)) {
        error('cycle', node.id, `${labelOf(node)} ends up attached to itself`);
        failed.add(node.id);
        break;
      }
      seen.add(at.id);
    }
  }

  // Placement on the parent's mount, and what it takes up; parents first, so nothing is placed on
  // equipment that could not be placed itself.
  const depth = (node: EquipmentNode): number => {
    let n = 0;
    for (let at = nodes.get(node.parent ?? ROOT_NODE); at; at = nodes.get(at.parent ?? ROOT_NODE))
      n++;
    return n;
  };
  const ordered = [...nodes.values()]
    .filter((node) => !failed.has(node.id))
    .sort((a, b) => depth(a) - depth(b));
  const claims: Resolved['claims'] = [];
  const taken = new Map<string, string>(); // "parent/mount/unit" -> node id
  for (const node of ordered) {
    if (failed.has(node.parent ?? ROOT_NODE)) {
      failed.add(node.id);
      continue;
    }
    const kind = equipment.get(node.kind) as KindInfo<EquipmentKindAttributes>;
    const parent = node.parent ?? ROOT_NODE;
    const holder = holders.get(parent) as Holder;
    const label = labelOf(node);
    const mount = holder.mounts.find((m) => m.id === node.mount);
    if (!mount) {
      error('unknown_mount', node.id, `${holder.label} has no mount "${node.mount}"`);
      failed.add(node.id);
      continue;
    }
    if (!kind.attributes.fits.some((tag) => mount.accepts.includes(tag))) {
      error(
        'not_accepted',
        node.id,
        `${label} doesn't go on the ${mount.label} of ${holder.label}`,
      );
      failed.add(node.id);
      continue;
    }
    const expected = { fixed: 'fixed', slots: 'slot', rail: 'rail' }[mount.layout.layout];
    if (node.placement.on !== expected) {
      const how = { fixed: 'no position', slot: 'a slot', rail: 'a start track' }[expected];
      error('wrong_placement', node.id, `The ${mount.label} of ${holder.label} takes ${how}`);
      failed.add(node.id);
      continue;
    }

    let units: string[];
    const claim: Resolved['claims'][number] = { node: node.id, parent, mount: mount.id };
    if (node.placement.on === 'slot' && mount.layout.layout === 'slots') {
      const slot = node.placement.slot;
      const slots = mount.layout.slots;
      if (!slots.includes(slot)) {
        error('unknown_slot', node.id, `The ${mount.label} of ${holder.label} has no slot ${slot}`);
        failed.add(node.id);
        continue;
      }
      const allowed = kind.attributes.placement?.slots;
      if (allowed && !allowed.includes(slot)) {
        error(
          'slot_not_allowed',
          node.id,
          `${label} can only go in ${allowed.join(', ')}, not ${slot}`,
        );
        failed.add(node.id);
        continue;
      }
      units = [slot, ...(kind.attributes.placement?.alsoClaims?.[slot] ?? [])];
      const missing = units.filter((s) => !slots.includes(s));
      if (missing.length > 0) {
        error(
          'unknown_slot',
          node.id,
          `${label} in ${slot} would also take ${missing.join(', ')}, which the ${mount.label} doesn't have`,
        );
        failed.add(node.id);
        continue;
      }
      claim.slots = units;
    } else if (node.placement.on === 'rail' && mount.layout.layout === 'rail') {
      const from = node.placement.track;
      const to = from + (kind.attributes.placement?.tracks ?? 1) - 1;
      if (to > mount.layout.tracks) {
        error(
          'off_rail',
          node.id,
          `${label} on tracks ${from} to ${to} runs past track ${mount.layout.tracks}`,
        );
        failed.add(node.id);
        continue;
      }
      units = Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
      claim.tracks = { from, to };
    } else {
      units = ['fixed'];
    }

    const clash = units
      .map((unit) => taken.get(`${parent}/${mount.id}/${unit}`))
      .find((other) => other !== undefined);
    if (clash) {
      const other = labelOf(nodes.get(clash) as EquipmentNode);
      error(
        'conflict',
        node.id,
        `${label} at ${placeWords(node)} overlaps ${other} on the ${mount.label}`,
      );
      failed.add(node.id);
      continue;
    }
    for (const unit of units) taken.set(`${parent}/${mount.id}/${unit}`, node.id);
    claims.push(claim);
  }

  // Children of anything that failed are not placed either.
  const placed = (id: string): boolean => {
    if (id === ROOT_NODE) return true;
    const node = nodes.get(id);
    return !!node && !failed.has(id) && placed(node.parent ?? ROOT_NODE);
  };

  // Sites: every placed holder's sites, minus those covered by equipment on the place they sit.
  const sites: Resolved['sites'] = [];
  for (const [id, holder] of holders) {
    if (!placed(id)) continue;
    for (const site of holder.sites) {
      const on = site.mount;
      const covered =
        on &&
        [...taken.keys()].some((key) =>
          on.slot ? key === `${id}/${on.mount}/${on.slot}` : key.startsWith(`${id}/${on.mount}/`),
        );
      if (covered) continue;
      sites.push({
        node: id,
        site: site.id,
        label:
          id === ROOT_NODE ? (site.label ?? site.id) : `${holder.label} ${site.label ?? site.id}`,
        accepts: site.accepts,
        capacity: site.capacity ?? 1,
      });
    }
  }

  // Capabilities come from what is actually there (and placed), not the model name.
  const performedBy = instrument.attributes.performedBy;
  const capabilities: Resolved['capabilities'] = [];
  const add = (node: string, providers: InstrumentKindAttributes['capabilities']) => {
    for (const p of providers ?? []) {
      capabilities.push({
        node,
        capability: p.capability,
        performedBy,
        ...(p.limits ? { limits: p.limits } : {}),
        ...(p.sites ? { sites: p.sites } : {}),
      });
    }
  };
  add(ROOT_NODE, instrument.attributes.capabilities);
  for (const node of nodes.values()) {
    if (placed(node.id)) add(node.id, equipment.get(node.kind)?.attributes.capabilities);
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    sites,
    claims,
    capabilities,
    issues,
  };
}
