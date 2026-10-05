import { describe, expect, it } from 'vitest';
import {
  Actor,
  DecimalString,
  Quantity,
  RecordId,
  RecordName,
  recordIdOf,
  toJsonSchemas,
} from './index.ts';

const ulid = '01J9Z3K8Q4ABCDEFGHJKMNPQRS';

describe('ids', () => {
  it('accepts prefixed ULIDs and rejects others', () => {
    expect(RecordId.safeParse(`lw_${ulid}`).success).toBe(true);
    expect(RecordId.safeParse(`LW_${ulid}`).success).toBe(false);
    expect(RecordId.safeParse('lw_123').success).toBe(false);
  });

  it('checks a specific prefix', () => {
    expect(recordIdOf('lw').safeParse(`lw_${ulid}`).success).toBe(true);
    expect(recordIdOf('lw').safeParse(`ins_${ulid}`).success).toBe(false);
    expect(() => recordIdOf('LW')).toThrow();
  });

  it('accepts readable names', () => {
    expect(RecordName.safeParse('PLT-000345').success).toBe(true);
    expect(RecordName.safeParse('plt-1').success).toBe(false);
  });
});

describe('quantities', () => {
  it('requires decimal strings', () => {
    expect(DecimalString.safeParse('12.5').success).toBe(true);
    expect(DecimalString.safeParse('-0.003').success).toBe(true);
    expect(DecimalString.safeParse('1e-3').success).toBe(false);
    expect(DecimalString.safeParse('01').success).toBe(false);
    expect(Quantity.safeParse({ value: 5, unit: 'uL' }).success).toBe(false);
    expect(Quantity.safeParse({ value: '5', unit: 'uL' }).success).toBe(true);
  });
});

describe('actors', () => {
  it('distinguishes people from agents acting on their behalf', () => {
    const userId = `usr_${ulid}`;
    expect(Actor.parse({ type: 'user', userId })).toEqual({ type: 'user', userId });
    expect(Actor.safeParse({ type: 'agent', agentName: 'Claude' }).success).toBe(false);
    expect(
      Actor.safeParse({ type: 'agent', agentName: 'Claude', onBehalfOf: userId }).success,
    ).toBe(true);
  });
});

describe('json schema', () => {
  it('exports every published schema', () => {
    const schemas = toJsonSchemas();
    expect(Object.keys(schemas).sort()).toEqual([
      'ActivityEntry',
      'Actor',
      'ExactSourceCitation',
      'ExactSourceReference',
      'OperationErrorBody',
      'Proposal',
      'ProposalReceipt',
      'Quantity',
      'RecordEnvelope',
      'RecordLink',
      'RecordVersion',
      'ScientificDecisionMetadata',
      'ScientificQuestion',
    ]);
  });
});
