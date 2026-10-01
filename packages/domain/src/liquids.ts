import type {
  ClassChoice,
  DispenseMode,
  LiquidClassAttributes,
  LiquidVolume,
  MixturePart,
  Quantity,
  VerificationAttributes,
  VerificationResult,
} from '@ailab/schema';
import { LabDecimal, toDecimalString } from './decimal.ts';
import type { AppliedEffects, MemoryCandidate } from './memory.ts';
import { compare, convert, formatQuantity } from './units.ts';

/** Liquid calculators (plan 009b): mixtures' liquid types, verification results, class choice. */

// ---------------------------------------------------------------------------------------------
// Mixtures (R8): the largest part decides, unless a listed solvent passes its threshold.

type Base = MixturePart['base'];

/** Fractions (by volume, in %) at which a solvent decides a mixture's type whatever else is in it. */
interface Threshold {
  percent: string;
  /** true: at least; false: over. */
  inclusive: boolean;
  words: string;
}
export const SOLVENT_THRESHOLDS: Partial<Record<Base, Threshold>> = {
  dmso: { percent: '70', inclusive: true, words: 'at least 70% DMSO pipettes as DMSO' },
  glycerol: { percent: '20', inclusive: false, words: 'over 20% glycerol pipettes as glycerol' },
  ethanol: { percent: '50', inclusive: true, words: 'at least 50% ethanol pipettes as ethanol' },
  volatile_organic: {
    percent: '50',
    inclusive: true,
    words: 'at least 50% volatile solvent pipettes as volatile',
  },
};

export interface MixtureType {
  liquidType: string;
  base: Base;
  /** Each base's share of the volume, in %. */
  shares: { base: Base; percent: string }[];
  why: string;
}

export function mixtureLiquidType(parts: MixturePart[]): MixtureType {
  if (parts.length === 0) throw new Error('A mixture needs at least one part');
  const unit = parts[0]?.volume.unit as string;
  const volumes = parts.map((p) => new LabDecimal(convert(p.volume, unit).value));
  const total = volumes.reduce((a, b) => a.plus(b), new LabDecimal(0));
  if (total.isZero()) throw new Error('The parts add up to nothing');
  const byBase = new Map<
    Base,
    { volume: LabDecimal; largest: { id: string; volume: LabDecimal } }
  >();
  parts.forEach((part, i) => {
    const volume = volumes[i] as LabDecimal;
    const entry = byBase.get(part.base);
    if (!entry) {
      byBase.set(part.base, { volume, largest: { id: part.liquidType, volume } });
      return;
    }
    entry.volume = entry.volume.plus(volume);
    if (volume.greaterThan(entry.largest.volume)) entry.largest = { id: part.liquidType, volume };
  });
  const shares = [...byBase.entries()]
    .map(([base, e]) => ({ base, percent: e.volume.dividedBy(total).times(100) }))
    .sort((a, b) => b.percent.comparedTo(a.percent));
  const out = (base: Base, why: string): MixtureType => ({
    liquidType: byBase.get(base)?.largest.id as string,
    base,
    shares: shares.map((s) => ({
      base: s.base,
      percent: toDecimalString(s.percent.toDecimalPlaces(2)),
    })),
    why,
  });
  for (const [base, rule] of Object.entries(SOLVENT_THRESHOLDS) as [Base, Threshold][]) {
    const share = shares.find((s) => s.base === base);
    const passes = rule.inclusive
      ? share?.percent.greaterThanOrEqualTo(rule.percent)
      : share?.percent.greaterThan(rule.percent);
    if (share && passes) {
      return out(
        base,
        `${toDecimalString(share.percent.toDecimalPlaces(1))}% ${base.replace('_', ' ')}: ${rule.words}`,
      );
    }
  }
  const top = shares[0] as (typeof shares)[number];
  return out(
    top.base,
    `The largest part is ${top.base.replace('_', ' ')} (${toDecimalString(top.percent.toDecimalPlaces(1))}%) and no solvent passes its threshold`,
  );
}

// ---------------------------------------------------------------------------------------------
// Verification (R11).

export function verificationResult(v: VerificationAttributes): VerificationResult {
  const target = new LabDecimal(v.target.value);
  if (target.isZero()) throw new Error('The target volume is zero');
  const mean = new LabDecimal(convert(v.mean, v.target.unit).value);
  const accuracy = mean.minus(target).dividedBy(target).times(100);
  const accurate = accuracy.abs().lessThanOrEqualTo(v.limits.accuracy);
  const precise = new LabDecimal(v.cv).lessThanOrEqualTo(v.limits.cv);
  const words = toDecimalString(accuracy.toDecimalPlaces(2));
  const why = [
    `accuracy ${words}% (limit ±${v.limits.accuracy}%)`,
    `CV ${v.cv}% (limit ${v.limits.cv}%)`,
  ].join(', ');
  return {
    accuracy: words,
    passed: accurate && precise,
    why: accurate && precise ? `Passed: ${why}` : `Failed: ${why}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Resolving a class (plan 009): explicit, then a product override, then the lab default.

export interface ClassInfo {
  id: string;
  label: string;
  attributes: LiquidClassAttributes;
  /** Confirmed; only confirmed classes are used. */
  active: boolean;
  /** Has a passing verification that isn't demo. */
  verified: boolean;
}

export interface ClassRequest {
  instrumentKind: string;
  device?: string | undefined;
  tip?: string | undefined;
  sourceLabware?: string | undefined;
  mode?: DispenseMode | undefined;
  volume: LiquidVolume;
  liquidType?: string | undefined;
  liquidTypeLabel?: string | undefined;
  explicit?: string | undefined;
  productOverrides?: string[] | undefined;
  /** What lab memory prefers and avoids among the classes (plan 005b). */
  memory?: Pick<AppliedEffects, 'prefer' | 'avoid'> | undefined;
}

/** Why a class doesn't fit the request, or undefined when it does. */
export function misfit(a: LiquidClassAttributes, r: ClassRequest): string | undefined {
  if (a.instrumentKind !== r.instrumentKind) return 'it is for another instrument model';
  if (a.device && a.device !== r.device) return 'it is for another pipette, head or chip';
  if (a.tips && r.tip && !a.tips.includes(r.tip)) return 'it is for other tips';
  if (a.tips && !r.tip) return 'it is for particular tips; say which tips';
  if (a.sourceLabware && a.sourceLabware !== r.sourceLabware)
    return 'it is for another source plate type';
  if (a.mode && r.mode && a.mode !== r.mode) return `it dispenses ${a.mode.replace('_', ', ')}`;
  if (a.volume?.min && compare(r.volume, a.volume.min) < 0)
    return `it starts at ${formatQuantity(a.volume.min as Quantity)}`;
  if (a.volume?.max && compare(r.volume, a.volume.max) > 0)
    return `it goes up to ${formatQuantity(a.volume.max as Quantity)}`;
  return undefined;
}

export function resolveClass(request: ClassRequest, classes: ClassInfo[]): ClassChoice {
  const prefer = request.memory?.prefer ?? new Map<string, MemoryCandidate>();
  const avoid = request.memory?.avoid ?? new Map<string, MemoryCandidate>();
  // A lab rule that avoids a class refuses it; a default only ranks it last.
  const refused = (c: ClassInfo) => avoid.get(c.id)?.attributes.strength === 'rule';
  const cite = (...ms: (MemoryCandidate | undefined)[]) => {
    const used = ms.flatMap((m) =>
      m ? [{ id: m.id, name: m.name, statement: m.attributes.statement }] : [],
    );
    return used.length ? { memory: used } : {};
  };
  const usable = classes.filter((c) => c.active && (!refused(c) || c.id === request.explicit));
  const fits = (c: ClassInfo) => misfit(c.attributes, request) === undefined;
  const serves = (c: ClassInfo) =>
    request.liquidType !== undefined && c.attributes.liquidTypes.includes(request.liquidType);
  const alternatives = usable
    .filter((c) => fits(c) && (serves(c) || request.liquidType === undefined))
    .map((c) => ({ liquidClass: c.id, label: c.label }));
  const choice = (c: ClassInfo, how: ClassChoice['how'], why: string): ClassChoice => ({
    liquidClass: c.id,
    label: c.label,
    how,
    why: `${why}${c.verified ? '' : '; not verified in this lab'}`,
    verified: c.verified,
    alternatives: alternatives.filter((a) => a.liquidClass !== c.id),
  });

  if (request.explicit) {
    const chosen = classes.find((c) => c.id === request.explicit);
    if (!chosen) {
      return none(`The chosen class ${request.explicit} isn't in the lab`, alternatives);
    }
    if (!chosen.active)
      return none(`${chosen.label} is still a draft; confirm it first`, alternatives);
    const wrong = misfit(chosen.attributes, request);
    if (wrong) return none(`${chosen.label} doesn't fit: ${wrong}`, alternatives);
    return choice(chosen, 'explicit', `Chosen on the step: ${chosen.label}`);
  }

  const override = usable.find((c) => request.productOverrides?.includes(c.id) && fits(c));
  if (override) {
    return choice(
      override,
      'product_override',
      `The product names ${override.label} for this device`,
    );
  }

  const preferred = usable.find((c) => prefer.has(c.id) && fits(c) && serves(c));
  if (preferred) {
    const m = prefer.get(preferred.id) as MemoryCandidate;
    return {
      ...choice(preferred, 'lab_memory', `Lab memory ${m.name} prefers ${preferred.label}`),
      ...cite(m),
    };
  }

  const liquid = request.liquidTypeLabel ?? 'this liquid type';
  if (!request.liquidType) {
    return none('The liquid has no liquid type; set one on the product first', alternatives);
  }
  const defaults = usable.filter((c) => c.attributes.labDefault && serves(c) && fits(c));
  const modes = [...new Set(defaults.map((c) => c.attributes.mode).filter(Boolean))];
  if (!request.mode && modes.length > 1) {
    return none(
      `Several default classes for ${liquid} fit and they dispense differently; say the dispense mode (${modes.join(', ')})`,
      alternatives,
    );
  }
  const kept = defaults.filter((c) => !avoid.has(c.id));
  const best = kept.find((c) => c.verified) ?? kept[0] ?? defaults[0];
  if (best) {
    const avoided = avoid.get(best.id);
    const passed = defaults
      .filter((c) => c !== best && avoid.has(c.id))
      .map((c) => avoid.get(c.id));
    const why = avoided
      ? `The lab's default for ${liquid} on this device and tip, though lab memory ${avoided.name} avoids it and nothing else fits`
      : `The lab's default for ${liquid} on this device and tip${
          passed.length
            ? `; lab memory ${passed.map((m) => m?.name).join(', ')} passed over another`
            : ''
        }`;
    return { ...choice(best, 'lab_default', why), ...cite(avoided, ...passed) };
  }
  const drafts = classes.filter((c) => !c.active && serves(c) && fits(c));
  return none(
    `No validated class for ${liquid} on this device and tip at ${formatQuantity(request.volume)}${
      drafts.length > 0
        ? `; draft ${drafts.map((d) => d.label).join(', ')} would fit once confirmed`
        : ''
    }${alternatives.length > 0 ? '; pick one of the alternatives or make one the default' : ''}`,
    alternatives,
  );
}

function none(issue: string, alternatives: ClassChoice['alternatives']): ClassChoice {
  return { how: 'none', why: issue, verified: false, issue, alternatives };
}
