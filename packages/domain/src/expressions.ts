import type { Quantity } from '@ailab/schema';
import type { Decimal } from 'decimal.js';
import { LabDecimal, toDecimalString } from './decimal.ts';
import { getUnit, isUnit, listUnits } from './units.ts';

/**
 * The expression language of digital SOPs (plan 012, G3): spreadsheet-like formulas over named
 * variables, with units checked and exact decimals, e.g.
 *
 *   n_samples * replicates * well_volume + dead_volume
 *   roundup(total_volume * 1.1, 0.5 mL)
 *   stock_volume = final_volume * (final_conc / stock_conc)
 *
 * Numbers may carry a unit (`50 uL`, `50 µL`, `1.5 mg/mL`, `37 °C`). `+` and `-` need the same kind
 * of quantity on both sides; `*` and `/` combine them, so a concentration over a concentration is a
 * plain number and a concentration times a volume over a concentration is a volume. Offset units
 * (°C) can be read and compared but not used in arithmetic.
 *
 * Functions: ceil, floor, round (plain numbers), roundup(x, step) and rounddown(x, step) to a
 * multiple of step, min(…), max(…), sum(…) and count(…) (lists are spread into them).
 */

export class ExpressionError extends Error {
  constructor(
    message: string,
    /** Where in the expression, from 0, when the problem is at one place. */
    readonly at?: number,
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/** A variable's value as the caller supplies it: a plain number, a quantity, or a list of either. */
export type ExpressionInput = string | Quantity | readonly (string | Quantity)[];

/** What an expression evaluates to. */
export type ExpressionResult =
  | { type: 'number'; value: string }
  | { type: 'quantity'; quantity: Quantity };

// ---- Parsing ----

export type ExpressionNode =
  | { type: 'number'; value: string; at: number }
  | { type: 'quantity'; value: string; unit: string; at: number }
  | { type: 'variable'; name: string; at: number }
  | { type: 'negate'; operand: ExpressionNode; at: number }
  | {
      type: 'binary';
      op: '+' | '-' | '*' | '/';
      left: ExpressionNode;
      right: ExpressionNode;
      at: number;
    }
  | { type: 'call'; name: string; args: ExpressionNode[]; at: number };

type Token =
  | { type: 'number'; value: string; unit?: string; at: number }
  | { type: 'name'; value: string; at: number }
  | { type: 'op'; value: string; at: number }
  | { type: 'end'; at: number };

/** Unit spellings a number may carry: every code, and the display symbols (µL, °C). */
const unitSpellings: [spelling: string, code: string][] = listUnits()
  .flatMap((u): [string, string][] => [
    [u.code, u.code],
    [u.symbol, u.code],
    [u.symbol.replace('µ', 'u'), u.code],
  ])
  .filter(([spelling]) => !spelling.includes(' ') || spelling === '× g')
  .sort((a, b) => b[0].length - a[0].length);

const wordChar = /[\p{L}\p{N}_]/u;

/** The unit spelled at `at`, the longest that ends at a word boundary. */
function unitAt(text: string, at: number): { code: string; length: number } | undefined {
  const od = /^OD\d{3,4}/.exec(text.slice(at));
  if (od && !wordChar.test(text[at + od[0].length] ?? '')) {
    return { code: od[0], length: od[0].length };
  }
  for (const [spelling, code] of unitSpellings) {
    if (!text.startsWith(spelling, at)) continue;
    const next = text[at + spelling.length] ?? '';
    const last = spelling.at(-1) ?? '';
    if (wordChar.test(last) && wordChar.test(next)) continue;
    return { code, length: spelling.length };
  }
  return undefined;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const number = /^(\d+(\.\d+)?|\.\d+)/.exec(text.slice(i));
    if (number) {
      const at = i;
      i += number[0].length;
      let j = i;
      while (j < text.length && /[ \t]/.test(text[j] as string)) j++;
      const unit = unitAt(text, j);
      if (unit) {
        tokens.push({ type: 'number', value: number[0], unit: unit.code, at });
        i = j + unit.length;
      } else tokens.push({ type: 'number', value: number[0], at });
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(text.slice(i));
    if (name) {
      tokens.push({ type: 'name', value: name[0], at: i });
      i += name[0].length;
      continue;
    }
    if ('+-*/(),'.includes(c)) {
      tokens.push({ type: 'op', value: c, at: i });
      i++;
      continue;
    }
    throw new ExpressionError(`"${c}" is not part of an expression`, i);
  }
  tokens.push({ type: 'end', at: text.length });
  return tokens;
}

/** Parses an expression into its tree, or throws an ExpressionError saying where it went wrong. */
export function parseExpression(text: string): ExpressionNode {
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i] as Token;
  const isOp = (value: string) => {
    const t = peek();
    return t.type === 'op' && t.value === value;
  };
  const expect = (value: string) => {
    const t = peek();
    if (t.type !== 'op' || t.value !== value) {
      throw new ExpressionError(`Expected "${value}" ${where(t)}`, t.at);
    }
    i++;
  };
  const where = (t: Token) =>
    t.type === 'end' ? 'at the end' : `before "${'value' in t ? t.value : ''}"`;

  const expression = (): ExpressionNode => {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const t = tokens[i++] as Token & { value: '+' | '-' };
      left = { type: 'binary', op: t.value, left, right: term(), at: t.at };
    }
    return left;
  };
  const term = (): ExpressionNode => {
    let left = unary();
    while (isOp('*') || isOp('/')) {
      const t = tokens[i++] as Token & { value: '*' | '/' };
      left = { type: 'binary', op: t.value, left, right: unary(), at: t.at };
    }
    return left;
  };
  const unary = (): ExpressionNode => {
    if (isOp('-')) {
      const at = peek().at;
      i++;
      return { type: 'negate', operand: unary(), at };
    }
    return primary();
  };
  const primary = (): ExpressionNode => {
    const t = peek();
    if (t.type === 'number') {
      i++;
      return t.unit
        ? { type: 'quantity', value: t.value, unit: t.unit, at: t.at }
        : { type: 'number', value: t.value, at: t.at };
    }
    if (t.type === 'name') {
      i++;
      if (!isOp('(')) return { type: 'variable', name: t.value, at: t.at };
      i++;
      const args: ExpressionNode[] = [];
      if (!isOp(')')) {
        args.push(expression());
        while (isOp(',')) {
          i++;
          args.push(expression());
        }
      }
      expect(')');
      return { type: 'call', name: t.value, args, at: t.at };
    }
    if (isOp('(')) {
      i++;
      const inner = expression();
      expect(')');
      return inner;
    }
    throw new ExpressionError(
      t.type === 'end' ? 'The expression ends too early' : `Unexpected "${t.value}"`,
      t.at,
    );
  };

  if (peek().type === 'end') throw new ExpressionError('The expression is empty', 0);
  const tree = expression();
  const rest = peek();
  if (rest.type !== 'end') {
    throw new ExpressionError(
      `Expected an operator ${where(rest)}${rest.type === 'name' && tokens[i - 1]?.type === 'number' ? ` ("${rest.value}" is not a unit)` : ''}`,
      rest.at,
    );
  }
  return tree;
}

/** The variables an expression reads, in order of first use. */
export function variablesOf(expression: string | ExpressionNode): string[] {
  const tree = typeof expression === 'string' ? parseExpression(expression) : expression;
  const names: string[] = [];
  const walk = (node: ExpressionNode) => {
    if (node.type === 'variable' && !names.includes(node.name)) names.push(node.name);
    if (node.type === 'negate') walk(node.operand);
    if (node.type === 'binary') {
      walk(node.left);
      walk(node.right);
    }
    if (node.type === 'call') node.args.forEach(walk);
  };
  walk(tree);
  return names;
}

// ---- Evaluation ----

/** Exponents of the registry's dimensions, e.g. {volume: 1} or {molar_concentration: 1, volume: 1}. */
type Dimensions = Record<string, number>;

interface Scalar {
  /** In the base unit of its dimensions. */
  base: LabDecimal;
  dims: Dimensions;
  /** The unit to show it in, when it has one. */
  unit?: string;
  /** Set for °C: readable and comparable, not for arithmetic. */
  offset?: boolean;
}

type Value = Scalar | Scalar[];

const plain = (base: LabDecimal): Scalar => ({ base, dims: {} });
const isPlain = (s: Scalar) => Object.keys(s.dims).length === 0;
const sameDims = (a: Dimensions, b: Dimensions) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
};
function combine(a: Dimensions, b: Dimensions, sign: 1 | -1): Dimensions {
  const out: Dimensions = { ...a };
  for (const [k, n] of Object.entries(b)) {
    const next = (out[k] ?? 0) + sign * n;
    if (next === 0) delete out[k];
    else out[k] = next;
  }
  return out;
}

function dimsWords(dims: Dimensions): string {
  if (Object.keys(dims).length === 0) return 'a plain number';
  return Object.entries(dims)
    .map(([k, n]) => `${k.replaceAll('_', ' ')}${n === 1 ? '' : `^${n}`}`)
    .join(' × ');
}

function fromQuantity(q: Quantity): Scalar {
  const unit = getUnit(q.unit);
  let value: LabDecimal;
  try {
    value = new LabDecimal(q.value);
  } catch {
    throw new ExpressionError(`"${q.value}" is not a number`);
  }
  return {
    base: value.times(unit.factor).plus(unit.offset ?? '0'),
    dims: { [unit.dimension]: 1 },
    unit: q.unit,
    ...(unit.offset === undefined ? {} : { offset: true }),
  };
}

function fromInput(name: string, input: ExpressionInput): Value {
  const one = (v: string | Quantity): Scalar => {
    if (typeof v !== 'string') return fromQuantity(v);
    try {
      return plain(new LabDecimal(v));
    } catch {
      throw new ExpressionError(`${name} is "${v}", not a number`);
    }
  };
  return Array.isArray(input) ? input.map(one) : one(input as string | Quantity);
}

function scalar(value: Value, what: string): Scalar {
  if (Array.isArray(value)) {
    throw new ExpressionError(`${what} is a list; use sum(…), count(…), min(…) or max(…)`);
  }
  return value;
}

function noOffset(s: Scalar, op: string) {
  if (s.offset) {
    throw new ExpressionError(
      `Temperatures in °C can't be used with "${op}"; convert them to a difference first`,
    );
  }
}

function binary(op: '+' | '-' | '*' | '/', a: Scalar, b: Scalar): Scalar {
  noOffset(a, op);
  noOffset(b, op);
  if (op === '+' || op === '-') {
    if (!sameDims(a.dims, b.dims)) {
      throw new ExpressionError(
        `Can't ${op === '+' ? 'add' : 'subtract'} ${dimsWords(b.dims)} ${op === '+' ? 'to' : 'from'} ${dimsWords(a.dims)}`,
      );
    }
    const unit = a.unit ?? b.unit;
    return {
      base: op === '+' ? a.base.plus(b.base) : a.base.minus(b.base),
      dims: a.dims,
      ...(unit ? { unit } : {}),
    };
  }
  if (op === '*') {
    const unit = isPlain(a) ? b.unit : isPlain(b) ? a.unit : undefined;
    return {
      base: a.base.times(b.base),
      dims: combine(a.dims, b.dims, 1),
      ...(unit ? { unit } : {}),
    };
  }
  if (b.base.isZero()) throw new ExpressionError('Division by zero');
  const dims = combine(a.dims, b.dims, -1);
  const unit = isPlain(b) ? a.unit : undefined;
  return {
    base: a.base.dividedBy(b.base),
    dims,
    ...(unit && Object.keys(dims).length > 0 ? { unit } : {}),
  };
}

function compare(a: Scalar, b: Scalar, fn: string): number {
  if (!sameDims(a.dims, b.dims)) {
    throw new ExpressionError(
      `${fn}(…) needs values of one kind, not ${dimsWords(a.dims)} and ${dimsWords(b.dims)}`,
    );
  }
  return a.base.comparedTo(b.base);
}

function call(name: string, args: Value[]): Scalar {
  const spread = () => args.flatMap((a) => (Array.isArray(a) ? a : [a]));
  const one = (fn: string) => {
    if (args.length !== 1) throw new ExpressionError(`${fn}(…) takes one value`);
    const x = scalar(args[0] as Value, `The value in ${fn}(…)`);
    if (!isPlain(x)) {
      throw new ExpressionError(
        `${fn}(…) works on plain numbers; to round ${dimsWords(x.dims)}, use roundup(value, step)`,
      );
    }
    return x;
  };
  const stepped = (fn: string, rounding: Decimal.Rounding) => {
    if (args.length !== 2) throw new ExpressionError(`${fn}(value, step) takes two values`);
    const x = scalar(args[0] as Value, `The value in ${fn}(…)`);
    const step = scalar(args[1] as Value, `The step in ${fn}(…)`);
    noOffset(x, fn);
    if (!sameDims(x.dims, step.dims)) {
      throw new ExpressionError(`${fn}(…) needs a step of the same kind as the value`);
    }
    if (step.base.lte(0)) throw new ExpressionError(`The step in ${fn}(…) must be more than zero`);
    const multiples = x.base.dividedBy(step.base).toDecimalPlaces(0, rounding);
    return {
      ...x,
      base: multiples.times(step.base),
      ...((x.unit ?? step.unit) ? { unit: (x.unit ?? step.unit) as string } : {}),
    };
  };
  switch (name) {
    case 'ceil':
      return plain(one('ceil').base.toDecimalPlaces(0, LabDecimal.ROUND_CEIL));
    case 'floor':
      return plain(one('floor').base.toDecimalPlaces(0, LabDecimal.ROUND_FLOOR));
    case 'round':
      return plain(one('round').base.toDecimalPlaces(0, LabDecimal.ROUND_HALF_UP));
    case 'roundup':
      return stepped('roundup', LabDecimal.ROUND_CEIL);
    case 'rounddown':
      return stepped('rounddown', LabDecimal.ROUND_FLOOR);
    case 'min':
    case 'max': {
      const all = spread();
      if (all.length === 0) throw new ExpressionError(`${name}(…) needs at least one value`);
      return all.reduce((best, x) => {
        const c = compare(x, best, name);
        return (name === 'min' ? c < 0 : c > 0) ? x : best;
      });
    }
    case 'sum': {
      const all = spread();
      if (all.length === 0) return plain(new LabDecimal(0));
      return all.reduce((total, x) => binary('+', total, x));
    }
    case 'count':
      return plain(new LabDecimal(spread().length));
    default:
      throw new ExpressionError(
        `There is no function "${name}"; use ceil, floor, round, roundup, rounddown, min, max, sum or count`,
      );
  }
}

function toResult(s: Scalar, unit: string | undefined): ExpressionResult {
  if (unit) {
    const target = getUnit(unit);
    if (!sameDims(s.dims, { [target.dimension]: 1 })) {
      throw new ExpressionError(
        `The result is ${dimsWords(s.dims)}, not ${target.dimension.replaceAll('_', ' ')} (${target.symbol})`,
      );
    }
    const value = s.base.minus(target.offset ?? '0').dividedBy(target.factor);
    return { type: 'quantity', quantity: { value: toDecimalString(value), unit } };
  }
  const dims = Object.entries(s.dims);
  if (dims.length === 0) return { type: 'number', value: toDecimalString(s.base) };
  if (s.unit) return toResult(s, s.unit);
  const [dimension, power] = dims[0] as [string, number];
  if (dims.length === 1 && power === 1) {
    // No unit came through (e.g. a volume computed from a product); show it in the base unit.
    const base = listUnits().find(
      (u) => u.dimension === dimension && u.factor === '1' && !u.offset,
    );
    if (base) return toResult(s, base.code);
  }
  throw new ExpressionError(
    `The result is ${dimsWords(s.dims)}, which has no unit; check the formula or give the unit it should have`,
  );
}

/**
 * Evaluates an expression. `lookup` gives each variable's value, or undefined when it has none
 * (then the error names it). With `unit`, the result is converted to that unit and must be of its
 * kind; without it, a quantity keeps the unit of the value it came from.
 */
export function evaluateExpression(
  expression: string | ExpressionNode,
  lookup: (name: string) => ExpressionInput | undefined,
  options: { unit?: string } = {},
): ExpressionResult {
  if (options.unit !== undefined && !isUnit(options.unit)) {
    throw new ExpressionError(`Unknown unit "${options.unit}"`);
  }
  const tree = typeof expression === 'string' ? parseExpression(expression) : expression;
  const walk = (node: ExpressionNode): Value => {
    switch (node.type) {
      case 'number':
        return plain(new LabDecimal(node.value));
      case 'quantity':
        return fromQuantity({ value: node.value, unit: node.unit });
      case 'variable': {
        const input = lookup(node.name);
        if (input === undefined) throw new ExpressionError(`${node.name} has no value`, node.at);
        return fromInput(node.name, input);
      }
      case 'negate': {
        const x = scalar(walk(node.operand), 'The value after "-"');
        noOffset(x, '-');
        return { ...x, base: x.base.negated() };
      }
      case 'binary':
        return binary(
          node.op,
          scalar(walk(node.left), `The left side of "${node.op}"`),
          scalar(walk(node.right), `The right side of "${node.op}"`),
        );
      case 'call':
        return call(node.name, node.args.map(walk));
    }
  };
  return toResult(scalar(walk(tree), 'The result'), options.unit);
}

// ---- Sets of variables ----

export interface VariableDefinition {
  name: string;
  /** A given value, or */
  value?: ExpressionInput;
  /** a formula over other variables. */
  expression?: string;
  /** The unit a computed value is shown in. */
  unit?: string;
}

export type VariableOutcome =
  | { name: string; ok: true; result: ExpressionResult | { type: 'list'; items: ExpressionInput } }
  | { name: string; ok: false; error: string; waitsOn?: string[] };

/**
 * Evaluates a set of variables in dependency order: given values first, then each formula once the
 * variables it reads have values. A formula in a cycle, or reading a variable that has no value,
 * gets an error saying which; the rest still evaluate.
 */
export function evaluateVariables(
  definitions: readonly VariableDefinition[],
): Map<string, VariableOutcome> {
  const byName = new Map(definitions.map((d) => [d.name, d]));
  const outcomes = new Map<string, VariableOutcome>();
  const values = new Map<string, ExpressionInput>();
  const visiting = new Set<string>();

  const resolve = (name: string, path: string[]): VariableOutcome => {
    const known = outcomes.get(name);
    if (known) return known;
    const d = byName.get(name);
    if (!d) return { name, ok: false, error: `There is no variable ${name}` };
    const done = (outcome: VariableOutcome) => {
      outcomes.set(name, outcome);
      return outcome;
    };
    if (d.expression === undefined) {
      if (d.value === undefined)
        return done({ name, ok: false, error: `${name} has no value yet` });
      values.set(name, d.value);
      if (Array.isArray(d.value))
        return done({ name, ok: true, result: { type: 'list', items: d.value } });
      const single = d.value as string | Quantity;
      return done({
        name,
        ok: true,
        result:
          typeof single === 'string'
            ? { type: 'number', value: single }
            : { type: 'quantity', quantity: single },
      });
    }
    if (visiting.has(name)) {
      const cycle = [...path.slice(path.indexOf(name)), name].join(' → ');
      return { name, ok: false, error: `The formulas go round in a circle: ${cycle}` };
    }
    let tree: ExpressionNode;
    try {
      tree = parseExpression(d.expression);
    } catch (error) {
      return done({ name, ok: false, error: (error as Error).message });
    }
    // A name that isn't a variable at all is a mistake in the formula, not an input still to come.
    const unknown = variablesOf(tree).filter((dependency) => !byName.has(dependency));
    if (unknown.length > 0) {
      return done({
        name,
        ok: false,
        error: `Uses ${unknown.join(', ')}, which ${unknown.length === 1 ? "isn't a declared variable" : "aren't declared variables"}`,
      });
    }
    visiting.add(name);
    const waitsOn: string[] = [];
    for (const dependency of variablesOf(tree)) {
      const outcome = resolve(dependency, [...path, name]);
      if (!outcome.ok) {
        waitsOn.push(dependency);
        if (outcome.error.startsWith('The formulas go round')) {
          visiting.delete(name);
          return done({ name, ok: false, error: outcome.error });
        }
      }
    }
    visiting.delete(name);
    if (waitsOn.length > 0) {
      return done({
        name,
        ok: false,
        error: `Waits for ${waitsOn.join(', ')}`,
        waitsOn,
      });
    }
    try {
      const result = evaluateExpression(tree, (n) => values.get(n), d.unit ? { unit: d.unit } : {});
      values.set(name, result.type === 'number' ? result.value : result.quantity);
      return done({ name, ok: true, result });
    } catch (error) {
      return done({ name, ok: false, error: (error as Error).message });
    }
  };

  for (const d of definitions) resolve(d.name, []);
  return outcomes;
}
