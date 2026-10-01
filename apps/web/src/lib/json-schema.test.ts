import { describe, expect, it } from 'vitest';
import {
  isQuantity,
  type JsonSchema,
  parseTyped,
  shapeKeys,
  typedByText,
  valueText,
} from './json-schema.ts';

const decimal: JsonSchema = { type: 'string', pattern: '^-?\\d+(\\.\\d+)?$' };
const quantity: JsonSchema = {
  type: 'object',
  properties: { value: decimal, unit: { type: 'string', enum: ['uL', 'mL', 'min'] } },
};
const name: JsonSchema = { type: 'string', pattern: '^[a-z][a-z0-9_]*$' };
// An SOP variable's value: a number, a quantity or a list of them.
const value = [decimal, quantity, { type: 'array', items: { anyOf: [decimal, quantity] } }];

describe('values as one line of text', () => {
  it('reads numbers, quantities and lists', () => {
    expect(parseTyped('3', value)).toEqual({ ok: true, value: '3' });
    expect(parseTyped('50 uL', value)).toEqual({ ok: true, value: { value: '50', unit: 'uL' } });
    expect(parseTyped('50 µL', value)).toEqual({ ok: true, value: { value: '50', unit: 'uL' } });
    expect(parseTyped('1, 2, 4', value)).toEqual({ ok: true, value: ['1', '2', '4'] });
    expect(parseTyped('50 parsecs', value)).toEqual({ ok: false });
  });

  it('reads a count as a whole number or a variable name', () => {
    const count = [{ type: 'integer', minimum: 1 }, name];
    expect(parseTyped('8', count)).toEqual({ ok: true, value: 8 });
    expect(parseTyped('sample_count', count)).toEqual({ ok: true, value: 'sample_count' });
    expect(parseTyped('8.5', count)).toEqual({ ok: false });
  });

  it('writes a value back the way it reads', () => {
    expect(valueText({ value: '50', unit: 'uL' })).toBe('50 uL');
    expect(valueText(['1', { value: '2', unit: 'mL' }])).toBe('1, 2 mL');
  });

  it('tells a quantity from an object that has a value and a unit among other fields', () => {
    expect(isQuantity(quantity)).toBe(true);
    expect(
      isQuantity({
        type: 'object',
        properties: { name, value: decimal, unit: { type: 'string' } },
      }),
    ).toBe(false);
  });

  it('knows which unions it can read', () => {
    expect(typedByText({ anyOf: value }, {})).toBe(true);
    expect(
      typedByText({ anyOf: [decimal, { type: 'object', properties: { a: decimal } }] }, {}),
    ).toBe(false);
  });
});

describe('variants told apart by what they hold', () => {
  it('names each by a required property no other variant has', () => {
    const instrument: JsonSchema = {
      type: 'object',
      properties: { instrument: { type: 'string' }, node: { type: 'string' } },
      required: ['instrument'],
    };
    const limits: JsonSchema = {
      type: 'object',
      properties: { limits: { type: 'object' } },
      required: ['limits'],
    };
    expect(shapeKeys([instrument, limits])).toEqual(['instrument', 'limits']);
    expect(shapeKeys([instrument, { ...instrument }])).toBeUndefined();
  });
});
