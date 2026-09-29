import type { Quantity } from '@ailab/schema';
import { DecimalString } from '@ailab/schema';
import { LabDecimal, toDecimalString } from './decimal.ts';

export interface UnitDefinition {
  /** Code used in data and APIs, ASCII only (e.g. "uL"). */
  code: string;
  /** Display symbol (e.g. "µL"). */
  symbol: string;
  /** Quantities convert only within one dimension. */
  dimension: string;
  /** Multiply by this to reach the dimension's base unit. */
  factor: string;
  /** Added after the factor to reach the base unit (only temperature uses this). */
  offset?: string;
}

export class UnitError extends Error {
  constructor(
    readonly code: 'unknown_unit' | 'incompatible_units' | 'invalid_value',
    message: string,
  ) {
    super(message);
    this.name = 'UnitError';
  }
}

type Row = [code: string, symbol: string, factor: string, offset?: string];

function family(dimension: string, rows: Row[]): UnitDefinition[] {
  return rows.map(([code, symbol, factor, offset]) => ({
    code,
    symbol,
    dimension,
    factor,
    ...(offset === undefined ? {} : { offset }),
  }));
}

const definitions: UnitDefinition[] = [
  ...family('volume', [
    ['L', 'L', '1'],
    ['mL', 'mL', '0.001'],
    ['uL', 'µL', '0.000001'],
    ['nL', 'nL', '0.000000001'],
    ['pL', 'pL', '0.000000000001'],
  ]),
  ...family('mass', [
    ['kg', 'kg', '1000'],
    ['g', 'g', '1'],
    ['mg', 'mg', '0.001'],
    ['ug', 'µg', '0.000001'],
    ['ng', 'ng', '0.000000001'],
    ['pg', 'pg', '0.000000000001'],
  ]),
  ...family('amount', [
    ['mol', 'mol', '1'],
    ['mmol', 'mmol', '0.001'],
    ['umol', 'µmol', '0.000001'],
    ['nmol', 'nmol', '0.000000001'],
    ['pmol', 'pmol', '0.000000000001'],
  ]),
  ...family('molar_concentration', [
    ['M', 'M', '1'],
    ['mM', 'mM', '0.001'],
    ['uM', 'µM', '0.000001'],
    ['nM', 'nM', '0.000000001'],
    ['pM', 'pM', '0.000000000001'],
  ]),
  ...family('mass_concentration', [
    ['g/L', 'g/L', '1'],
    ['mg/mL', 'mg/mL', '1'],
    ['ug/uL', 'µg/µL', '1'],
    ['mg/L', 'mg/L', '0.001'],
    ['ug/mL', 'µg/mL', '0.001'],
    ['ng/uL', 'ng/µL', '0.001'],
    ['ng/mL', 'ng/mL', '0.000001'],
    ['pg/mL', 'pg/mL', '0.000000001'],
  ]),
  ...family('molar_mass', [
    ['g/mol', 'g/mol', '1'],
    ['Da', 'Da', '1'],
    ['kDa', 'kDa', '1000'],
  ]),
  ...family('time', [
    ['ms', 'ms', '0.001'],
    ['s', 's', '1'],
    ['min', 'min', '60'],
    ['h', 'h', '3600'],
    ['d', 'd', '86400'],
  ]),
  ...family('temperature', [
    ['K', 'K', '1'],
    ['degC', '°C', '1', '273.15'],
  ]),
  ...family('length', [
    ['m', 'm', '1'],
    ['cm', 'cm', '0.01'],
    ['mm', 'mm', '0.001'],
    ['um', 'µm', '0.000001'],
    ['nm', 'nm', '0.000000001'],
  ]),
  ...family('rotational_speed', [['rpm', 'rpm', '1']]),
  ...family('relative_centrifugal_force', [['xg', '× g', '1']]),
  ...family('cell_count', [['cells', 'cells', '1']]),
  ...family('cell_density', [
    ['cells/mL', 'cells/mL', '1'],
    ['cells/uL', 'cells/µL', '1000'],
    ['cells/L', 'cells/L', '0.001'],
  ]),
  ...family('volume_percent', [['%v/v', '% v/v', '1']]),
  ...family('mass_volume_percent', [['%w/v', '% w/v', '1']]),
  ...family('mass_percent', [['%w/w', '% w/w', '1']]),
  ...family('enzyme_activity', [
    ['kU', 'kU', '1000'],
    ['U', 'U', '1'],
    ['mU', 'mU', '0.001'],
  ]),
  ...family('activity_concentration', [
    ['U/uL', 'U/µL', '1000'],
    ['U/mL', 'U/mL', '1'],
    ['U/L', 'U/L', '0.001'],
    ['mU/mL', 'mU/mL', '0.001'],
  ]),
  ...family('colony_count', [['CFU', 'CFU', '1']]),
  ...family('colony_density', [
    ['CFU/uL', 'CFU/µL', '1000'],
    ['CFU/mL', 'CFU/mL', '1'],
    ['CFU/L', 'CFU/L', '0.001'],
  ]),
];

const registry = new Map(definitions.map((unit) => [unit.code, unit]));

/** Optical density at a wavelength in nm, e.g. "OD600". Each wavelength is its own dimension. */
const opticalDensity = /^OD(\d{3,4})$/;

export function getUnit(code: string): UnitDefinition {
  const known = registry.get(code);
  if (known) return known;
  const od = opticalDensity.exec(code);
  if (od) {
    return { code, symbol: `OD${od[1]}`, dimension: `optical_density_${od[1]}nm`, factor: '1' };
  }
  throw new UnitError('unknown_unit', `Unknown unit "${code}"`);
}

export function isUnit(code: string): boolean {
  return registry.has(code) || opticalDensity.test(code);
}

/** Every fixed unit in the registry (optical density units are open-ended and not listed). */
export function listUnits(): readonly UnitDefinition[] {
  return definitions;
}

export function quantity(value: string, unit: string): Quantity {
  if (!DecimalString.safeParse(value).success) {
    throw new UnitError('invalid_value', `"${value}" is not a decimal string`);
  }
  getUnit(unit);
  return { value, unit };
}

function toBase(q: Quantity): LabDecimal {
  const unit = getUnit(q.unit);
  return new LabDecimal(q.value).times(unit.factor).plus(unit.offset ?? '0');
}

function fromBase(base: LabDecimal, code: string): Quantity {
  const unit = getUnit(code);
  const value = base.minus(unit.offset ?? '0').dividedBy(unit.factor);
  return { value: toDecimalString(value), unit: code };
}

function assertSameDimension(a: string, b: string): void {
  const from = getUnit(a);
  const to = getUnit(b);
  if (from.dimension !== to.dimension) {
    throw new UnitError(
      'incompatible_units',
      `Cannot convert ${from.symbol} (${from.dimension}) to ${to.symbol} (${to.dimension})`,
    );
  }
}

export function convert(q: Quantity, unit: string): Quantity {
  assertSameDimension(q.unit, unit);
  if (q.unit === unit) return quantity(toDecimalString(new LabDecimal(q.value)), unit);
  return fromBase(toBase(q), unit);
}

/** Difference-safe arithmetic: both sides are converted to `a`'s unit. Temperatures cannot be added. */
function arithmetic(a: Quantity, b: Quantity, op: 'plus' | 'minus'): Quantity {
  if (getUnit(a.unit).offset !== undefined || getUnit(b.unit).offset !== undefined) {
    throw new UnitError(
      'incompatible_units',
      'Offset units such as °C cannot be added or subtracted',
    );
  }
  const right = new LabDecimal(convert(b, a.unit).value);
  return { value: toDecimalString(new LabDecimal(a.value)[op](right)), unit: a.unit };
}

export function add(a: Quantity, b: Quantity): Quantity {
  return arithmetic(a, b, 'plus');
}

export function subtract(a: Quantity, b: Quantity): Quantity {
  return arithmetic(a, b, 'minus');
}

export function multiply(q: Quantity, factor: string): Quantity {
  return { value: toDecimalString(new LabDecimal(q.value).times(factor)), unit: q.unit };
}

/** -1, 0 or 1. */
export function compare(a: Quantity, b: Quantity): number {
  assertSameDimension(a.unit, b.unit);
  return toBase(a).comparedTo(toBase(b));
}

/** Mass concentration → molar concentration, using the molar mass (e.g. from the record's molecular weight). */
export function massToMolar(
  massConcentration: Quantity,
  molarMass: Quantity,
  unit = 'M',
): Quantity {
  assertSameDimension(massConcentration.unit, 'g/L');
  assertSameDimension(molarMass.unit, 'g/mol');
  const molar = toBase(massConcentration).dividedBy(toBase(molarMass));
  return convert({ value: toDecimalString(molar), unit: 'M' }, unit);
}

/** Molar concentration → mass concentration, using the molar mass. */
export function molarToMass(
  molarConcentration: Quantity,
  molarMass: Quantity,
  unit = 'g/L',
): Quantity {
  assertSameDimension(molarConcentration.unit, 'M');
  assertSameDimension(molarMass.unit, 'g/mol');
  const mass = toBase(molarConcentration).times(toBase(molarMass));
  return convert({ value: toDecimalString(mass), unit: 'g/L' }, unit);
}

export function formatQuantity(q: Quantity): string {
  return `${q.value} ${getUnit(q.unit).symbol}`;
}
