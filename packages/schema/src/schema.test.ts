import { describe, expect, it } from 'vitest';
import {
  Actor,
  DecimalString,
  Quantity,
  RecordEnvelope,
  RecordId,
  RecordName,
  recordIdOf,
  toJsonSchemas,
} from './index.ts';

const ulid = '01J9Z3K8Q4ABCDEFGHJKMNPQRS';

describe('record creation provenance', () => {
  it('reads old absent origins and new known/unknown origins, rejecting unsupported claims', () => {
    const envelope = {
      id: `wdg_${ulid}`,
      kind: 'widget',
      name: 'WDG-0001',
      label: 'Widget',
      orgId: `org_${ulid}`,
      labId: `lab_${ulid}`,
      status: 'draft',
      version: 1,
      attributes: {},
      evidence: {},
      reviews: {},
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      createdBy: { type: 'user', userId: `usr_${ulid}` },
      updatedBy: { type: 'user', userId: `usr_${ulid}` },
    };
    expect(RecordEnvelope.parse(envelope)).not.toHaveProperty('origin');
    for (const origin of [
      { type: 'unknown' },
      { type: 'user_message', conversation: `cnv_${ulid}`, message: 'message-a' },
    ])
      expect(RecordEnvelope.parse({ ...envelope, origin }).origin).toEqual(origin);
    expect(
      RecordEnvelope.safeParse({
        ...envelope,
        origin: { type: 'conversation', conversation: `cnv_${ulid}` },
      }).success,
    ).toBe(false);
  });
});

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
      'SopDefaultDecisionPreview',
      'SopDefaultEdit',
      'SopInputDecision',
      'SopInputDecisionPreview',
    ]);
  });
});
