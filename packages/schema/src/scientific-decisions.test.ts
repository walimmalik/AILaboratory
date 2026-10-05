import { describe, expect, it } from 'vitest';
import {
  ConfirmationScope,
  DeferredObligation,
  ExactSourceCitation,
  ExactSourceReference,
  OpenQuestion,
  OriginatingIntent,
  Proposal,
  ProposalReceipt,
  ScientificDecisionMetadata,
  ScientificQuestion,
  SopAttributes,
} from './index.ts';

const ulid = '01J9Z3K8Q4ABCDEFGHJKMNPQRS';
const sop = `sop_${ulid}`;
const user = { type: 'user', userId: `usr_${ulid}` };
const at = '2026-10-05T12:00:00Z';
const source = {
  document: `doc_${ulid}`,
  version: 2,
  file: `fil_${ulid}`,
  sha256: 'a'.repeat(64),
  parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
  title: 'Reviewed wash instructions',
};
const question = {
  id: 'wash_volume',
  about: { step: 'wash' },
  question: 'Which compatible wash method should be used?',
  stage: { stage: 'method', reason: 'The source instruction conflicts with the plate maximum' },
  responses: [{ text: "I don't know", by: user, at, version: 3 }],
  disposition: { status: 'open' },
};
const resolution = {
  status: 'resolved',
  proposal: `prp_${ulid}`,
  proposedBy: { type: 'agent', agentName: 'Scientist', onBehalfOf: user.userId },
  acceptedBy: user,
  at,
  action: {
    type: 'resolve',
    sop,
    expectedVersion: 3,
    question: question.id,
    reason: 'Use the source-supported compatible plate',
    basis: { type: 'evidence', sources: [source], records: [] },
    affected: [{ id: sop, version: 3, paths: ['/materials/coating_plate'] }],
  },
  recheck: { version: 4, checks: [{ id: 'wash_capacity', passed: true }], at },
};

describe('scientific question contract', () => {
  it('keeps an unknown response open; reply text cannot represent resolution', () => {
    expect(ScientificQuestion.parse(question).disposition.status).toBe('open');
    expect(
      ScientificQuestion.safeParse({ ...question, disposition: { status: 'answered' } }).success,
    ).toBe(false);
    expect(
      ScientificQuestion.safeParse({
        ...question,
        disposition: { status: 'resolved', answer: 'yes' },
      }).success,
    ).toBe(false);
  });

  it('requires exact accepted change, human acceptance and passing recheck for a resolution', () => {
    const unchecked = { ...source, parse: { status: 'unavailable', reason: 'Parse failed' } };
    expect(
      ScientificQuestion.safeParse({
        ...question,
        disposition: {
          ...resolution,
          action: {
            ...resolution.action,
            basis: { type: 'evidence', sources: [unchecked], records: [] },
          },
        },
      }).success,
    ).toBe(false);
    expect(ScientificQuestion.safeParse({ ...question, disposition: resolution }).success).toBe(
      true,
    );
    expect(
      ScientificQuestion.safeParse({
        ...question,
        disposition: { ...resolution, acceptedBy: resolution.proposedBy },
      }).success,
    ).toBe(false);
    expect(
      ScientificQuestion.safeParse({
        ...question,
        disposition: {
          ...resolution,
          recheck: { ...resolution.recheck, checks: [{ id: 'wash_capacity', passed: false }] },
        },
      }).success,
    ).toBe(false);
    const variation = {
      ...resolution,
      action: {
        ...resolution.action,
        basis: {
          type: 'scientific_rationale',
          rationale: 'A fully specified experimental comparison',
          validation: 'unvalidated_method_variation',
          sources: [],
        },
      },
    };
    expect(ScientificQuestion.safeParse({ ...question, disposition: variation }).success).toBe(
      true,
    );
    expect(
      ScientificQuestion.safeParse({
        ...question,
        disposition: {
          ...variation,
          action: {
            ...variation.action,
            basis: { ...variation.action.basis, validation: 'validated' },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('requires a concrete later-stage binding at creation and deferral', () => {
    const obligation = {
      stage: 'run',
      condition: 'Name the operator before execution',
      binding: { type: 'run_check', check: 'operator' },
    };
    expect(DeferredObligation.safeParse(obligation).success).toBe(true);
    expect(DeferredObligation.safeParse({ stage: 'run', condition: 'Check later' }).success).toBe(
      false,
    );
    expect(DeferredObligation.safeParse({ ...obligation, stage: 'experiment' }).success).toBe(
      false,
    );
    expect(
      ScientificQuestion.safeParse({ ...question, stage: { stage: 'run', reason: 'Ask later' } })
        .success,
    ).toBe(false);
    const deferred = {
      status: 'deferred',
      proposal: resolution.proposal,
      proposedBy: resolution.proposedBy,
      acceptedBy: user,
      at,
      action: {
        type: 'defer',
        sop,
        expectedVersion: 3,
        question: question.id,
        reason: 'Operator is specific to a run',
        obligation,
      },
    };
    expect(ScientificQuestion.safeParse({ ...question, disposition: deferred }).success).toBe(
      false,
    );
    expect(
      ScientificQuestion.safeParse({
        ...question,
        stage: {
          stage: 'run',
          reason: 'Operator is specific to a run',
          binding: obligation.binding,
        },
        disposition: deferred,
      }).success,
    ).toBe(true);
  });

  it('does not activate the replacement on existing persisted answered SOPs', () => {
    const existing = {
      id: 'wash',
      question: 'Which wash?',
      status: 'answered',
      answer: "I don't know",
    };
    expect(OpenQuestion.safeParse(existing).success).toBe(true);
    expect(
      SopAttributes.safeParse({ materials: [], variables: [], steps: [], questions: [existing] })
        .success,
    ).toBe(true);
    expect(ScientificQuestion.safeParse(existing).success).toBe(false);
  });
});

describe('source identity and decision authority', () => {
  it('pins source bytes and parsed passages independently of a newer library edition', () => {
    expect(
      ExactSourceCitation.safeParse({ source, passage: 'wash-1', quote: 'Reviewed instruction' })
        .success,
    ).toBe(true);
    expect(ExactSourceReference.safeParse({ ...source, version: undefined }).success).toBe(false);
    expect(ExactSourceReference.safeParse({ ...source, sha256: 'latest' }).success).toBe(false);
    const unavailable = {
      ...source,
      parse: { status: 'unavailable', reason: 'PDF could not be parsed' },
    };
    expect(ExactSourceReference.safeParse(unavailable).success).toBe(true);
    expect(
      ExactSourceCitation.safeParse({
        source: unavailable,
        passage: 'wash-1',
        quote: 'Unchecked text',
      }).success,
    ).toBe(false);
  });

  it('identifies each request by the authenticated originating user message', () => {
    const first = OriginatingIntent.parse({
      type: 'user_message',
      conversation: `cnv_${ulid}`,
      message: 'message-a',
    });
    const second = OriginatingIntent.parse({ ...first, message: 'message-b' });
    expect(first).not.toEqual(second);
    expect(
      OriginatingIntent.safeParse({ type: 'unknown', conversation: `cnv_${ulid}` }).success,
    ).toBe(false);
  });

  it('limits supporting confirmation to exact record versions, excluding final SOP and arbitrary calls', () => {
    const scope = {
      type: 'confirmation_scope',
      records: [{ id: `ent_${ulid}`, version: 1, kind: 'entity' }],
    };
    expect(ConfirmationScope.safeParse(scope).success).toBe(true);
    expect(
      ConfirmationScope.safeParse({ ...scope, records: [{ id: sop, version: 1, kind: 'sop' }] })
        .success,
    ).toBe(false);
    expect(
      ConfirmationScope.safeParse({ ...scope, records: [...scope.records, ...scope.records] })
        .success,
    ).toBe(false);
    expect(
      ConfirmationScope.safeParse({ ...scope, operations: [{ operation: 'records.confirm' }] })
        .success,
    ).toBe(false);
    expect(
      ScientificDecisionMetadata.safeParse({
        origin: { type: 'unknown' },
        reads: [],
        writes: [],
        sources: [],
        previewIdentity: { digest: 'c'.repeat(64), preparedAt: at },
        scope,
      }).success,
    ).toBe(true);
  });
});

describe('committed proposal receipt', () => {
  it('carries actual validated output and touched record IDs separately from preview', () => {
    const receipt = { output: { id: sop, version: 4 }, recordIds: [sop], committedAt: at };
    expect(ProposalReceipt.parse(receipt)).toEqual(receipt);
    expect(ProposalReceipt.safeParse({ ...receipt, recordIds: ['preview-id'] }).success).toBe(
      false,
    );
    expect(ProposalReceipt.safeParse({ ...receipt, calculation: 'made-up' }).success).toBe(false);
    expect(
      Proposal.parse({
        id: resolution.proposal,
        operationId: 'records.update',
        input: {},
        preview: { version: 3 },
        status: 'approved',
        proposedBy: resolution.proposedBy,
        proposedAt: at,
        receipt,
      }).receipt,
    ).toEqual(receipt);
  });
});
