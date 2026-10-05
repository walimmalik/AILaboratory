import {
  libraryRead,
  type OriginatingIntent,
  type PageContext,
  ScientificQuestion,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';
import { findProposal, toProposal } from '../operations/proposal-store.ts';
import type { OperationDeps } from '../operations/registry.ts';
import { type RecordContext, RecordService } from '../records/service.ts';
import { skills } from '../skills/skills.ts';
import { findConversation, messageRows, personOf } from './store.ts';
import { pageNamespaces } from './toolset.ts';

/** Selection is context only. Re-read it under the caller's scope before every turn. */
export async function pageNote(
  deps: OperationDeps,
  ctx: RecordContext,
  page: PageContext | undefined,
): Promise<string> {
  if (!page) return '';
  if (/^\/library\/instructions(?:\/|$)/.test(page.path) && !page.selectedSource)
    throw new OperationError(
      'invalid_input',
      'The exact instructions reader needs its selected source. Refresh the reader before asking.',
    );
  const records = new RecordService(deps.db, deps.kinds);
  const notes: string[] = [];
  const namespaces = new Set(pageNamespaces(page, deps.kinds));
  const relevantSkills = skills.filter((skill) => namespaces.has(skill.module));
  if (relevantSkills.length)
    notes.push(
      `Skills for this page: ${relevantSkills.map((skill) => `${skill.module} (${skill.name})`).join(', ')}. To read each relevant owning skill, call ${relevantSkills.map((skill) => `skills_get with ${JSON.stringify({ name: skill.module })}`).join('; ')} unless already read. Use these exact existing skill names, not operation namespaces.`,
    );
  if (page.selectedSource) {
    const { source, passage, section } = page.selectedSource;
    const result = await deps.registry.execute(
      ctx,
      libraryRead.id,
      {
        source,
        ...(passage === undefined ? {} : { passages: [passage] }),
        ...(section === undefined ? {} : { section }),
      },
      {},
      deps.db,
    );
    if (result.status !== 'done')
      throw new OperationError('internal', 'The selected instructions could not be resolved.');
    const resolved = libraryRead.output.parse(result.output);
    if (!resolved.source)
      throw new OperationError('unavailable', 'The selected exact source is unavailable.');
    notes.push(
      `Selected exact instructions (server-resolved metadata): ${JSON.stringify({ source: resolved.source, ...(passage === undefined ? {} : { passage }), ...(section === undefined ? {} : { section }), ...(resolved.parse ? { warnings: resolved.parse.warnings } : {}) })}. Read this reference through library.read; never substitute current document text or infer missing instructions. This selection grants no source adoption, scientific disposition or confirmation authority.`,
    );
    if (resolved.source.parse.status === 'unavailable')
      notes.push(
        'Text could not be checked for this attachment. Keep it unchecked; do not invent or infer its instructions.',
      );
  }
  if (page.record) {
    const record = await records.get(ctx, page.record.id);
    if (record.version !== page.record.version)
      throw new OperationError(
        'version_conflict',
        'The selected record changed. Refresh it before continuing.',
      );
    if (record.kind === 'sop') {
      const questions = (record.attributes as { questions?: unknown }).questions ?? [];
      const parsed = ScientificQuestion.array().safeParse(questions);
      if (!parsed.success) {
        if (page.activeQuestion)
          throw new OperationError(
            'unavailable',
            'This question uses unsupported historical data. Scientific question recovery requires reconciliation before use.',
          );
        notes.push(
          'Scientific question context is unavailable: this record has unsupported historical questions. Do not infer that an old answer resolved them.',
        );
      } else {
        const current = parsed.data;
        if (page.activeQuestion) {
          const selected = current.find((question) => question.id === page.activeQuestion?.id);
          if (!selected)
            throw new OperationError(
              'not_found',
              'The selected scientific question no longer exists.',
            );
          if (
            selected.stage.stage !== page.activeQuestion.stage ||
            selected.disposition.status !== 'open'
          )
            throw new OperationError(
              'invalid_state',
              'The selected question changed or is no longer open. Refresh it before continuing.',
            );
        }
        notes.push(
          `Current scientific questions for ${record.name} at version ${record.version}: ${JSON.stringify(current)}. Responses are observations, not accepted resolutions.`,
        );
        if (page.activeQuestion)
          notes.push(
            'To explicitly save a response to this selected question, the person can use Record response beneath their reply in this chat; the question response action on the SOP page is an alternative. Ordinary chat or notes do not save a response. Only the person can record it through sops.answer_question; never claim a response was recorded from prose.',
          );
        if (current.some((question) => question.responses.length))
          notes.push(
            'Continue from saved responses, including unknowns; do not ask an identical already-answered question. An unknown response leaves the issue open and disputed method settings unchanged. Investigate available evidence or suggest a specific next action to obtain it. Only an explicit human sops.answer_question action records a response: ordinary chat or notes do not. Never call that people-only operation or claim you recorded a response from prose.',
          );
      }
    } else if (page.activeQuestion) {
      throw new OperationError('invalid_input', 'Scientific question context needs an SOP record.');
    }
  }
  if (page.proposal) {
    const row = await findProposal(deps.db, ctx, page.proposal.id);
    if (row.proposedBy.type !== 'agent' || row.proposedBy.onBehalfOf !== personOf(ctx))
      throw new OperationError('not_found', 'This proposal is not from an agent working for you.');
    if (row.status === 'pending') {
      const inputs =
        row.operationId === 'changes.apply'
          ? ((row.input as { steps?: { input: unknown }[] }).steps?.map((step) => step.input) ?? [])
          : [row.input];
      const pins = inputs.flatMap((input) => {
        const pin = input as { id?: unknown; expectedVersion?: unknown };
        return typeof pin.id === 'string' && typeof pin.expectedVersion === 'number'
          ? [{ id: pin.id, version: pin.expectedVersion }]
          : [];
      });
      for (const pin of [
        ...pins,
        ...(row.decision?.reads ?? []),
        ...(row.decision?.writes ?? []),
      ]) {
        const record = await records.get(ctx, pin.id);
        if (record.version !== pin.version)
          throw new OperationError(
            'version_conflict',
            'The pending proposal refers to changed records. Refresh its preview before continuing.',
          );
      }
    }
    notes.push(
      `Authoritative proposal state: ${JSON.stringify(toProposal(row))}. A pending proposal is not accepted; conversation text grants no approval.`,
    );
  }
  return notes.length ? `\n\nCurrent selected context:\n${notes.join('\n')}` : '';
}

/** Retain a request only when the reply names pending work actually produced by that request. */
export async function replyOrigin(
  deps: OperationDeps,
  ctx: RecordContext,
  reply: { conversation: string; message: string } | undefined,
  page: PageContext | undefined,
): Promise<OriginatingIntent | undefined> {
  await pageNote(deps, ctx, page);
  if (!reply) return undefined;
  if (!page?.proposal && !page?.activeQuestion)
    throw new OperationError(
      'invalid_input',
      'A contextual reply needs a selected pending proposal or open question.',
    );
  const scopedRows = new Map<string, Awaited<ReturnType<typeof messageRows>>>();
  const loadRows = async (conversation: string) => {
    const existing = scopedRows.get(conversation);
    if (existing) return existing;
    await findConversation(deps.db, ctx, conversation);
    const rows = await messageRows(deps.db, conversation);
    scopedRows.set(conversation, rows);
    return rows;
  };
  const rows = await loadRows(reply.conversation);
  const index = rows.findIndex((row) => row.body.role === 'user' && row.body.id === reply.message);
  const original = rows[index]?.body;
  if (original?.role !== 'user' || original.origin?.type !== 'user_message')
    throw new OperationError(
      'invalid_input',
      'The originating user message is unavailable. Send this as a new request.',
    );
  const origin = original.origin;
  const rootRows = await loadRows(origin.conversation);
  const root = rootRows.find((row) => row.body.id === origin.message)?.body;
  if (
    root?.role !== 'user' ||
    root.origin?.type !== 'user_message' ||
    root.origin.conversation !== origin.conversation ||
    root.origin.message !== origin.message
  )
    throw new OperationError(
      'invalid_input',
      'The originating user message is unavailable. Send this as a new request.',
    );
  const next = rows.findIndex((row, position) => position > index && row.body.role === 'user');
  const turn = rows.slice(index + 1, next < 0 ? undefined : next);
  if (page.proposal) {
    const proposal = await findProposal(deps.db, ctx, page.proposal.id);
    if (proposal.status !== 'pending')
      throw new OperationError('invalid_state', 'The selected proposal is no longer pending.');
    // The proposal identifies its producing conversation, including a reply in a new chat.
    // Read only that conversation and require its actual producing turn to retain this root.
    const session = proposal.proposedBy.type === 'agent' && proposal.proposedBy.sessionRef;
    const producedRows = session ? await loadRows(session) : [];
    const producedIndex = producedRows.findIndex(
      (row) =>
        row.body.role === 'tool' &&
        row.body.outcome === 'proposed' &&
        (row.body.result as { proposal?: { id?: string } })?.proposal?.id === proposal.id,
    );
    const producer = producedRows
      .slice(0, producedIndex)
      .findLast((row) => row.body.role === 'user')?.body;
    if (
      producedIndex < 0 ||
      producer?.role !== 'user' ||
      producer.origin?.type !== 'user_message' ||
      producer.origin.conversation !== origin.conversation ||
      producer.origin.message !== origin.message
    )
      throw new OperationError(
        'invalid_input',
        'This proposal did not originate from the selected user message.',
      );
  }
  if (page.activeQuestion && page.record) {
    const id = page.record.id;
    if (
      [root, original].some(
        (message) =>
          message.page?.activeQuestion &&
          (message.page.record?.id !== id ||
            message.page.activeQuestion.id !== page.activeQuestion?.id),
      )
    )
      throw new OperationError(
        'invalid_input',
        'This question is unrelated to the selected user message.',
      );
    const matches =
      (original.page?.record?.id === id &&
        (!original.page.activeQuestion ||
          original.page.activeQuestion.id === page.activeQuestion.id)) ||
      turn.some((row) => {
        if (row.body.role !== 'tool' || row.body.outcome !== 'done') return false;
        const result = row.body.result as {
          output?: { id?: string; results?: { output?: { id?: string } }[] };
        };
        return (
          result?.output?.id === id ||
          result?.output?.results?.some((step) => step.output?.id === id)
        );
      });
    if (!matches)
      throw new OperationError(
        'invalid_input',
        'This question is unrelated to the selected user message.',
      );
  }
  return origin;
}

/** Existing tool results retain proposal identity across reloads without a new task store. */
export async function pendingNote(
  deps: OperationDeps,
  ctx: RecordContext,
  conversationId: string,
): Promise<string> {
  const rows = await messageRows(deps.db, conversationId);
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.body.role === 'tool' && row.body.outcome === 'proposed'
          ? [(row.body.result as { proposal?: { id?: string } })?.proposal?.id].filter(
              (id): id is string => Boolean(id),
            )
          : [],
      ),
    ),
  ];
  const states = await Promise.all(
    ids.map(async (id) => toProposal(await findProposal(deps.db, ctx, id))),
  );
  return states.length
    ? `\n\nCurrent proposal states from this conversation: ${JSON.stringify(states)}. Pending changes still need explicit human approval.`
    : '';
}
