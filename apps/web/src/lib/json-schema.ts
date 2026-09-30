/**
 * Reading a kind's JSON Schema (from `records.kinds`) for the value editors: references resolved,
 * quantities and variants recognised, and values that one line of text can say parsed from it.
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  description?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
}

export function resolve(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const ref = schema.$ref?.match(/^#\/\$defs\/(.+)$/)?.[1];
  return ref && root.$defs?.[ref] ? resolve(root.$defs[ref], root) : schema;
}

/** A quantity is exactly a value and a unit; an SOP variable also has both, among others. */
export function isQuantity(s: JsonSchema): boolean {
  const keys = Object.keys(s.properties ?? {});
  return (
    s.type === 'object' && keys.length === 2 && keys.includes('value') && keys.includes('unit')
  );
}

/** The property whose `const` tells the variants apart, e.g. "layout" or "shape". */
export function discriminator(variants: JsonSchema[]): string | undefined {
  const first = variants[0]?.properties ?? {};
  return Object.keys(first).find((key) =>
    variants.every((v) => v.properties?.[key]?.const !== undefined),
  );
}

/** Values one line of text can say: numbers, names, quantities ("50 uL") and lists of them. */
export function typedByText(s: JsonSchema, root: JsonSchema): boolean {
  if (s.type === 'string' || s.type === 'integer' || s.type === 'number' || isQuantity(s))
    return !s.enum;
  const variants = (s.oneOf ?? s.anyOf)?.map((v) => resolve(v, root));
  if (variants) return variants.every((v) => typedByText(v, root));
  if (s.type === 'array' && s.items) {
    const item = resolve(s.items, root);
    return item.type !== 'array' && typedByText(item, root);
  }
  return false;
}

/** The value as text: "50 µL" stays "50 uL" so it reads back the same. */
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object') {
    const { value: v, unit } = value as { value?: unknown; unit?: unknown };
    return `${v ?? ''} ${unit ?? ''}`.trim();
  }
  return String(value);
}

const matches = (s: JsonSchema, text: string) => !s.pattern || new RegExp(s.pattern).test(text);

/** Reads text as the first variant it fits, or undefined when none does. */
export function parseTyped(
  text: string,
  variants: JsonSchema[],
  root: JsonSchema = {},
): { ok: true; value: unknown } | { ok: false } {
  const t = text.trim();
  for (const raw of variants) {
    const v = resolve(raw, root);
    if (v.oneOf ?? v.anyOf) {
      const inner = parseTyped(
        t,
        (v.oneOf ?? v.anyOf ?? []).map((x) => resolve(x, root)),
        root,
      );
      if (inner.ok) return inner;
    } else if ((v.type === 'integer' || v.type === 'number') && /^-?\d+(\.\d+)?$/.test(t)) {
      if (v.type === 'number' || Number.isInteger(Number(t))) return { ok: true, value: Number(t) };
    } else if (isQuantity(v)) {
      const m = /^(-?\d+(?:\.\d+)?)\s*([^\d\s,].*)$/.exec(t);
      const unitSchema = v.properties?.unit ?? {};
      const units = (unitSchema.enum ?? (unitSchema.const ? [unitSchema.const] : [])).map(String);
      const unit = m?.[2]?.trim().replace('µ', 'u');
      if (m && unit && (units.length === 0 || units.includes(unit)))
        return { ok: true, value: { value: m[1], unit } };
    } else if (v.type === 'array' && v.items && t.includes(',')) {
      const parts = t.split(',').map((part) => parseTyped(part, [v.items as JsonSchema], root));
      if (parts.every((p) => p.ok))
        return { ok: true, value: parts.map((p) => (p as { value: unknown }).value) };
    } else if (v.type === 'string' && matches(v, t)) {
      return { ok: true, value: t };
    }
  }
  return { ok: false };
}
