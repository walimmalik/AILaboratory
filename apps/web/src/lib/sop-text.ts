import { ExpressionError, getUnit, isUnit, unitAt, variablesOf } from '@ailab/domain';
import type {
  DecimalString,
  Quantity,
  SopMaterial,
  SopStep,
  SopVariable,
  StepParameter,
} from '@ailab/schema';
import { closest } from './formulas.ts';

/**
 * An SOP's values and materials read out of plain text (ADR 0046): a formula or a step's words are
 * one text box where each value and material is recognized by its lab name as it is typed, without
 * brackets. The stored form does not change (ADR 0036, 0037): formulas keep technical names
 * (`wells * well_volume * 1.1`) and step words keep `` `well_volume` ``, so agents read and write
 * what they always have. What a value's text says decides its kind: a number is a usual value, a
 * formula is worked out, `Capture antibody.working concentration` is read from that material.
 */

export interface ValueTerm {
  type: 'value';
  /** The technical name formulas and agents use, e.g. well_volume. */
  name: string;
  /** In lab words, e.g. "Well volume". */
  label: string;
  /** Its dimension when it has a unit (volume, time…), for reading settings out of step words. */
  dimension?: string;
}

export interface MaterialTerm {
  type: 'material';
  /** The role steps and agents use, e.g. coating_plate. */
  name: string;
  label: string;
  /** Fields a value can be read from, as paths (deadVolume, workingVolume.max). */
  fields: string[];
}

export type Term = ValueTerm | MaterialTerm;

export interface Terms {
  values: ValueTerm[];
  materials: MaterialTerm[];
}

/** formula: a value's box; words: a step's words, where only values and materials are marked. */
export type TextMode = 'formula' | 'words';

export type Token =
  | { type: 'space' | 'text' | 'op' | 'fn'; text: string; from: number }
  | { type: 'number'; text: string; from: number; value: string; unit?: string }
  | { type: 'value'; text: string; from: number; name: string }
  | { type: 'material'; text: string; from: number; name: string; field?: string }
  | { type: 'unknown'; text: string; from: number; suggestion?: Term; field?: boolean };

export const functionNames = [
  'roundup',
  'rounddown',
  'ceil',
  'floor',
  'round',
  'min',
  'max',
  'sum',
  'count',
];

/** Fields most records of a material type have, offered after `Material.`. */
const commonFields: Partial<Record<SopMaterial['type'], string[]>> = {
  labware: ['deadVolume', 'maxVolume', 'workingVolume.min', 'workingVolume.max'],
  consumable: ['deadVolume', 'maxVolume'],
  reagent: ['workingConcentration', 'stockConcentration', 'concentration'],
  solution: ['workingConcentration', 'concentration'],
  entity: ['concentration'],
};

/** An SOP as edited so far: any of its lists, items maybe half filled in. */
export type SopDoc = {
  variables?: readonly Partial<SopVariable>[] | undefined;
  materials?: readonly Partial<SopMaterial>[] | undefined;
  solutions?: readonly { role?: string; label?: string; text?: string }[] | undefined;
  steps?: readonly Partial<SopStep>[] | undefined;
};

const unitDimension = (unit: string | undefined) =>
  unit && isUnit(unit) ? getUnit(unit).dimension : undefined;

function valueDimension(v: Partial<SopVariable>): string | undefined {
  if (v.kind === 'computed') return unitDimension(v.unit);
  const first = Array.isArray(v.value) ? v.value[0] : v.value;
  return first && typeof first === 'object' ? unitDimension(first.unit) : undefined;
}

/**
 * The names an SOP's text can use: its values, and its materials, solutions and what its steps
 * make (a coated plate). `self` (a value's own name) is left out of the values.
 */
export function sopTerms(doc: SopDoc, self?: string): Terms {
  const values: ValueTerm[] = [];
  for (const v of doc.variables ?? []) {
    if (!v.name || !v.label || v.name === self) continue;
    const dimension = valueDimension(v);
    values.push({
      type: 'value',
      name: v.name,
      label: v.label,
      ...(dimension ? { dimension } : {}),
    });
  }
  const materials: MaterialTerm[] = [];
  const seen = new Set<string>();
  const add = (role: string | undefined, label: string | undefined, fields: string[]) => {
    if (!role || !label || seen.has(role)) return;
    seen.add(role);
    const used = (doc.variables ?? []).flatMap((v) =>
      v.readFrom?.role === role && v.readFrom.field ? [v.readFrom.field] : [],
    );
    materials.push({
      type: 'material',
      name: role,
      label,
      fields: [...new Set([...used, ...fields])],
    });
  };
  for (const m of doc.materials ?? []) add(m.role, m.label, (m.type && commonFields[m.type]) ?? []);
  for (const s of doc.solutions ?? []) add(s.role, s.label, commonFields.solution ?? []);
  for (const s of doc.steps ?? []) for (const p of s.produces ?? []) add(p.role, p.label, []);
  return { values, materials };
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();

const wordChar = /[\p{L}\p{N}_]/u;
const isWordChar = (c: string | undefined) => !!c && wordChar.test(c);

/** A field path in words: workingVolume.max → "working volume.max". */
export function fieldWords(path: string): string {
  return path
    .split('.')
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase())
    .join('.');
}

/** Words as a field path: "working volume.max" → workingVolume.max. */
export function fieldPath(words: string): string {
  return words
    .split('.')
    .map((part) =>
      part
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w, i) => (i === 0 ? w : (w[0] ?? '').toUpperCase() + w.slice(1)))
        .join(''),
    )
    .join('.');
}

/** Every term by label, longest first, so "Wells per plate" wins over "Wells". */
function byLength(terms: Terms): Term[] {
  return [...terms.values, ...terms.materials].sort((a, b) => b.label.length - a.label.length);
}

function termNamed(terms: Terms, name: string): Term | undefined {
  return terms.values.find((v) => v.name === name) ?? terms.materials.find((m) => m.name === name);
}

function termLabelled(terms: Terms, words: string): Term | undefined {
  const q = squash(words);
  return [...terms.values, ...terms.materials].find((t) => squash(t.label) === q);
}

/**
 * Reads text into tokens. Values and materials are matched by lab name, longest first and at word
 * edges; in a formula regardless of case, in step words as written, so "wells" in a sentence is
 * not the value "Wells". Brackets (`[Well volume]`) and technical names are read too.
 */
export function tokenize(text: string, terms: Terms, mode: TextMode): Token[] {
  const labels = byLength(terms);
  const out: Token[] = [];
  const formula = mode === 'formula';
  const labelAt = (i: number): Term | undefined => {
    if (isWordChar(text[i - 1])) return undefined;
    for (const t of labels) {
      const piece = text.slice(i, i + t.label.length);
      const same = formula ? piece.toLowerCase() === t.label.toLowerCase() : piece === t.label;
      if (same && !isWordChar(text[i + t.label.length])) return t;
    }
    return undefined;
  };
  const push = (token: Token) => {
    const last = out.at(-1);
    // Plain text runs merge, so the painted mirror stays small.
    if (token.type === 'text' && last?.type === 'text') last.text += token.text;
    else out.push(token);
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const c = text[i] as string;
    const space = /^\s+/.exec(rest);
    if (space) {
      push({ type: 'space', text: space[0], from: i });
      i += space[0].length;
      continue;
    }
    const bracket = /^\[([^\]\n]*)\]/.exec(rest);
    if (bracket && formula) {
      const t =
        termLabelled(terms, bracket[1] ?? '') ?? termNamed(terms, (bracket[1] ?? '').trim());
      push(
        t
          ? { type: t.type, text: bracket[0], from: i, name: t.name }
          : { ...unknownWords(bracket[0], bracket[1] ?? '', terms), from: i },
      );
      i += bracket[0].length;
      continue;
    }
    const tick = /^`([A-Za-z_][A-Za-z0-9_]*)`/.exec(rest);
    if (tick && !formula) {
      const t = termNamed(terms, tick[1] as string);
      push(
        t
          ? { type: t.type, text: tick[0], from: i, name: t.name }
          : { type: 'unknown', text: tick[0], from: i },
      );
      i += tick[0].length;
      continue;
    }
    const term = labelAt(i);
    if (term) {
      const end = i + term.label.length;
      if (term.type === 'material' && formula && text[end] === '.') {
        const field = /^\.([A-Za-z][A-Za-z0-9 ]*(?:\.[A-Za-z][A-Za-z0-9 ]*)*)/.exec(
          text.slice(end),
        );
        const words = field?.[1]?.trimEnd();
        if (words) {
          const whole = text.slice(i, end + 1 + words.length);
          push({
            type: 'material',
            text: whole,
            from: i,
            name: term.name,
            field: fieldPath(words),
          });
          i += whole.length;
          continue;
        }
      }
      push({ type: term.type, text: text.slice(i, end), from: i, name: term.name });
      i = end;
      continue;
    }
    const number = /^-?(\d+(\.\d+)?|\.\d+)/.exec(rest);
    const signed = number?.[0].startsWith('-');
    if (number && !isWordChar(text[i - 1]) && (!signed || !formula)) {
      let j = i + number[0].length;
      while (text[j] === ' ') j++;
      const unit = unitAt(text, j);
      const end = unit ? j + unit.length : i + number[0].length;
      push({
        type: 'number',
        text: text.slice(i, end),
        from: i,
        value: number[0],
        ...(unit ? { unit: unit.code } : {}),
      });
      i = end;
      continue;
    }
    if (formula && '+-−*/×÷(),'.includes(c)) {
      push({ type: 'op', text: c, from: i });
      i++;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (formula && word) {
      if (
        functionNames.includes(word[0].toLowerCase()) &&
        /^\s*\(/.test(rest.slice(word[0].length))
      ) {
        push({ type: 'fn', text: word[0], from: i });
        i += word[0].length;
        continue;
      }
      const named = termNamed(terms, word[0]);
      if (named) {
        push({ type: named.type, text: word[0], from: i, name: named.name });
        i += word[0].length;
        continue;
      }
      // A run of words that names nothing, up to where a known name starts.
      const run = /^[A-Za-z_][A-Za-z0-9_]*(?: +[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest)?.[0] ?? word[0];
      let cut = run.length;
      for (let k = 1; k < run.length; k++) {
        if (run[k - 1] === ' ' && labelAt(i + k)) {
          cut = k;
          break;
        }
      }
      const words = run.slice(0, cut).trimEnd();
      push({ ...unknownWords(words, words, terms), from: i });
      i += words.length;
      continue;
    }
    if (!formula && word) {
      push({ type: 'text', text: word[0], from: i });
      i += word[0].length;
      continue;
    }
    push(formula ? { type: 'unknown', text: c, from: i } : { type: 'text', text: c, from: i });
    i++;
  }
  return out;
}

function unknownWords(
  text: string,
  words: string,
  terms: Terms,
): { type: 'unknown'; text: string; suggestion?: Term } {
  const suggestion = closest(words, [...terms.values, ...terms.materials]);
  return {
    type: 'unknown',
    text,
    ...(suggestion ? { suggestion: suggestion as Term } : {}),
  };
}

const symbol = (unit: string) => (isUnit(unit) ? getUnit(unit).symbol : unit);

/** A stored formula in lab words: `wells * well_volume * 1.1` → "Wells × Well volume × 1.1". */
export function formulaText(expression: string, terms: Terms): string {
  const byName = new Map(terms.values.map((v) => [v.name, v.label]));
  let out = '';
  let last = 0;
  // Numbers keep their unit, so a value called "mL" can't eat one.
  const pattern = /(\d+(?:\.\d+)?|\.\d+)(\s*)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|(\*)|(\/)|(-)/g;
  for (const m of expression.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at < last) continue;
    out += expression.slice(last, at);
    last = at + m[0].length;
    if (m[1] !== undefined) {
      const unit = unitAt(expression, at + m[0].length);
      if (unit) {
        out += `${m[1]} ${symbol(unit.code)}`;
        last += unit.length;
      } else out += m[0];
    } else if (m[3]) out += (m[4] ? m[3] : byName.get(m[3])) ?? m[3];
    else if (m[5]) out += '×';
    else if (m[6]) out += '÷';
    else out += '−';
    if (m[4]) out += m[4];
  }
  return out + expression.slice(last);
}

export type Read<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      /** In lab words, e.g. `There is no value "Well vol". Did you mean Well volume?` */
      problem: string;
      /** The text to replace and what to put there, when a fix is likely. */
      fix?: { from: number; to: number; text: string };
    };

function unknownProblem(t: Extract<Token, { type: 'unknown' }>): Read<never> {
  const words = t.text.replace(/^\[|\]$/g, '').trim();
  if (/^[^A-Za-z0-9_[]$/.test(t.text))
    return { ok: false, problem: `"${t.text}" can't be part of a formula` };
  return {
    ok: false,
    problem: `There is no value or material "${words}"${t.suggestion ? `. Did you mean ${t.suggestion.label}?` : ''}`,
    ...(t.suggestion
      ? { fix: { from: t.from, to: t.from + t.text.length, text: t.suggestion.label } }
      : {}),
  };
}

/** A formula as the calculator's text, or what is wrong with it in lab words. */
export function formulaOf(text: string, terms: Terms): Read<string> {
  const tokens = tokenize(text, terms, 'formula');
  const unknown = tokens.find((t) => t.type === 'unknown');
  if (unknown) return unknownProblem(unknown);
  const material = tokens.find((t) => t.type === 'material');
  if (material?.type === 'material') {
    const label = terms.materials.find((m) => m.name === material.name)?.label ?? material.name;
    return {
      ok: false,
      problem: material.field
        ? `A formula can't read ${label} directly. Add ${label}.${fieldWords(material.field)} as a value of its own and use that`
        : `Say which of ${label}'s values, e.g. ${label}.${fieldWords(terms.materials.find((m) => m.name === material.name)?.fields[0] ?? 'dead volume')}`,
    };
  }
  const expression = tokens
    .map((t) => {
      if (t.type === 'value') return t.name;
      if (t.type === 'number') return t.unit ? `${t.value} ${t.unit}` : t.value;
      if (t.type === 'op')
        return ({ '×': '*', '÷': '/', '−': '-' } as Record<string, string>)[t.text] ?? t.text;
      if (t.type === 'space') return ' ';
      return t.text;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  try {
    variablesOf(expression);
  } catch (e) {
    if (!(e instanceof ExpressionError)) throw e;
    return { ok: false, problem: formulaText(e.message, terms) };
  }
  return { ok: true, value: expression };
}

type PlainValue = DecimalString | Quantity | (DecimalString | Quantity)[];

/** "8", "100 µL" or "1, 2, 4" as a stored value; undefined when the text is not only that. */
export function plainValue(text: string): PlainValue | undefined {
  const items = text.split(',').map((s) => s.trim());
  if (items.some((s) => s === '')) return undefined;
  const read: (DecimalString | Quantity)[] = [];
  for (const item of items) {
    const n = /^-?(0|[1-9]\d*)(\.\d+)?/.exec(item);
    if (!n) return undefined;
    const rest = item.slice(n[0].length).trimStart();
    if (!rest) {
      read.push(n[0] as DecimalString);
      continue;
    }
    const unit = unitAt(rest, 0);
    if (!unit || unit.length !== rest.length) return undefined;
    read.push({ value: n[0] as DecimalString, unit: unit.code });
  }
  return read.length === 1 ? read[0] : read;
}

/** What a value's box text makes it, in the stored fields that change with it. */
export type ValueFields = Pick<SopVariable, 'kind'> &
  Partial<Pick<SopVariable, 'value' | 'expression' | 'readFrom'>>;

/**
 * Reads a value's text: nothing or a number (a usual value, or chosen each run), a material's
 * field (read from it), or a formula (worked out). `perRun` is the "Ask each run" choice.
 */
export function readValue(text: string, terms: Terms, perRun: boolean): Read<ValueFields> {
  const t = text.trim();
  if (!t) return { ok: true, value: { kind: perRun ? 'input' : 'default' } };
  const plain = plainValue(t);
  if (plain !== undefined)
    return { ok: true, value: { kind: perRun ? 'input' : 'default', value: plain } };
  const tokens = tokenize(t, terms, 'formula').filter((k) => k.type !== 'space');
  const [only] = tokens;
  if (tokens.length === 1 && only?.type === 'material' && only.field) {
    return {
      ok: true,
      value: { kind: 'record', readFrom: { role: only.name, field: only.field } },
    };
  }
  const formula = formulaOf(t, terms);
  if (!formula.ok) {
    // A fix points into the trimmed text; move it back to where it is in what was typed.
    const lead = text.length - text.trimStart().length;
    return formula.fix
      ? {
          ...formula,
          fix: { ...formula.fix, from: formula.fix.from + lead, to: formula.fix.to + lead },
        }
      : formula;
  }
  return { ok: true, value: { kind: 'computed', expression: formula.value } };
}

const valueWords = (v: DecimalString | Quantity) =>
  typeof v === 'string' ? v : `${v.value} ${symbol(v.unit)}`;

/** A stored value as the text its box shows. */
export function valueText(v: Partial<SopVariable>, terms: Terms): string {
  if (v.kind === 'computed') return v.expression ? formulaText(v.expression, terms) : '';
  if (v.kind === 'record' && v.readFrom) {
    const m = terms.materials.find((x) => x.name === v.readFrom?.role);
    return `${m?.label ?? v.readFrom.role}.${fieldWords(v.readFrom.field)}`;
  }
  if (v.value === undefined) return '';
  return Array.isArray(v.value) ? v.value.map(valueWords).join(', ') : valueWords(v.value);
}

/** A value's kind in a couple of words, shown next to it. */
export function kindWords(v: Partial<SopVariable>, terms: Terms): string {
  if (v.kind === 'computed') return 'worked out';
  if (v.kind === 'input') return 'asked each run';
  if (v.kind === 'record') {
    const m = terms.materials.find((x) => x.name === v.readFrom?.role);
    return `read from ${m?.label ?? v.readFrom?.role ?? 'a material'}`;
  }
  return 'usual value';
}

/** Step words in lab words: `` `well_volume` `` → "Well volume". Unknown names stay as written. */
export function wordsText(stored: string, terms: Terms): string {
  return stored.replace(/`([A-Za-z_][A-Za-z0-9_]*)`/g, (whole, name: string) => {
    return termNamed(terms, name)?.label ?? whole;
  });
}

/** Step words as stored: each value and material named in them becomes `` `name` ``. */
export function wordsStored(text: string, terms: Terms): string {
  return tokenize(text, terms, 'words')
    .map((t) => (t.type === 'value' || t.type === 'material' ? `\`${t.name}\`` : t.text))
    .join('');
}

/** Setting names by the dimension of the amount that sets them. */
const settingOf: Record<string, string> = {
  volume: 'volume',
  time: 'duration',
  temperature: 'temperature',
  rotational_speed: 'speed',
  relative_centrifugal_force: 'speed',
  mass_concentration: 'concentration',
  molar_concentration: 'concentration',
};

type Setting = Omit<StepParameter, 'name'>;

/**
 * The materials and values a step's words name, in order, and the settings they state: one volume, one time,
 * one temperature… each read from a value (`Add Well volume`) or an amount (`2 h`, `37 °C`). A
 * setting stated twice (two volumes) is left for a person or the assistant to say.
 */
export function readWords(
  text: string,
  terms: Terms,
): { uses: string[]; values: string[]; settings: Map<string, Setting> } {
  const tokens = tokenize(text, terms, 'words');
  const uses = [...new Set(tokens.flatMap((t) => (t.type === 'material' ? [t.name] : [])))];
  const values = [...new Set(tokens.flatMap((t) => (t.type === 'value' ? [t.name] : [])))];
  const found = new Map<string, Setting[]>();
  const note = (name: string | undefined, s: Setting) => {
    if (name) found.set(name, [...(found.get(name) ?? []), s]);
  };
  for (const t of tokens) {
    if (t.type === 'value') {
      const dimension = terms.values.find((v) => v.name === t.name)?.dimension;
      note(dimension && settingOf[dimension], { variable: t.name });
    } else if (t.type === 'number' && t.unit) {
      const dimension = getUnit(t.unit).dimension;
      const name = dimension === 'length' && t.unit === 'nm' ? 'wavelength' : settingOf[dimension];
      note(name, { quantity: { value: t.value as DecimalString, unit: t.unit } });
    }
  }
  if (/\broom temperature\b/i.test(text)) note('temperature', { text: 'room temperature' });
  const settings = new Map<string, Setting>();
  for (const [name, all] of found) {
    const distinct = new Set(all.map((s) => JSON.stringify(s)));
    if (distinct.size === 1) settings.set(name, all[0] as Setting);
  }
  return { uses, values, settings };
}

/**
 * A step after its words changed. What the old words stated and the new ones don't is dropped;
 * what the new words state replaces it; uses and settings the words never stated (an agent's, or
 * set under More) stay as they are.
 */
export function withWords(
  step: Partial<SopStep>,
  text: string,
  terms: Terms,
): Pick<SopStep, 'text'> & Partial<Pick<SopStep, 'uses' | 'parameters'>> {
  const before = readWords(wordsText(step.text ?? '', terms), terms);
  const after = readWords(text, terms);
  const keptUses = (step.uses ?? []).filter((u) => !before.uses.includes(u));
  const uses = [...new Set([...after.uses, ...keptUses])];
  const kept = (step.parameters ?? []).filter(
    (p) => !after.settings.has(p.name) && !before.settings.has(p.name),
  );
  const parameters = [
    ...kept,
    ...[...after.settings].map(([name, s]) => ({ name, ...s }) as StepParameter),
  ];
  return {
    text: wordsStored(text, terms),
    ...(uses.length ? { uses } : { uses: undefined }),
    ...(parameters.length ? { parameters } : { parameters: undefined }),
  } as Pick<SopStep, 'text'> & Partial<Pick<SopStep, 'uses' | 'parameters'>>;
}

export interface Suggestion {
  label: string;
  what: 'value' | 'material' | 'field' | 'function';
  /** The text that replaces what was typed. */
  insert: string;
}

/**
 * What the text before the caret could be: values and materials by lab name (and, in a formula,
 * functions, and a material's fields after `Material.`). `from` is where the typed part starts.
 */
export function picksAt(
  text: string,
  caret: number,
  terms: Terms,
  mode: TextMode,
): { from: number; picks: Suggestion[] } | undefined {
  const before = text.slice(0, caret);
  if (isWordChar(text[caret])) return undefined;
  if (mode === 'formula') {
    for (const m of terms.materials) {
      const at = before.toLowerCase().lastIndexOf(`${m.label.toLowerCase()}.`);
      if (at < 0 || isWordChar(before[at - 1])) continue;
      const typed = before.slice(at + m.label.length + 1);
      if (!/^[A-Za-z0-9 .]*$/.test(typed)) continue;
      const q = squash(typed);
      const picks = m.fields
        .map(fieldWords)
        .filter((f) => squash(f).startsWith(q) && squash(f) !== q)
        .map((f): Suggestion => ({ label: f, what: 'field', insert: f }));
      return picks.length ? { from: at + m.label.length + 1, picks } : undefined;
    }
  }
  const all = [...terms.values, ...terms.materials];
  // The typed part may be several words ("Standard po"): try the longest that starts a name.
  const starts: number[] = [];
  for (let k = before.length - 1; k >= 0; k--) {
    if (!isWordChar(before[k])) {
      if (!/[ ]/.test(before[k] as string)) break;
      continue;
    }
    if (!isWordChar(before[k - 1])) starts.push(k);
  }
  const min = mode === 'formula' ? 1 : 3;
  for (const from of starts.reverse()) {
    const typed = before.slice(from);
    if (typed.length < min || /\s$/.test(typed)) continue;
    const q = squash(typed);
    const last = !typed.includes(' ');
    const hits = all
      .filter((t) => {
        const label = squash(t.label);
        if (label === q) return false;
        return label.startsWith(q) || (last && label.split(' ').some((w) => w.startsWith(q)));
      })
      .sort(
        (a, b) => Number(!squash(a.label).startsWith(q)) - Number(!squash(b.label).startsWith(q)),
      );
    const picks: Suggestion[] = hits.map((t) => ({
      label: t.label,
      what: t.type,
      insert: t.type === 'material' && mode === 'formula' ? `${t.label}.` : t.label,
    }));
    if (mode === 'formula' && last)
      for (const f of functionNames)
        if (f.startsWith(typed.toLowerCase()) && f !== typed.toLowerCase())
          picks.push({ label: `${f}(…)`, what: 'function', insert: `${f}(` });
    if (picks.length) return { from, picks: picks.slice(0, 8) };
  }
  return undefined;
}
