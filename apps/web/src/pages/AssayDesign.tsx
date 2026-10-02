import {
  type AssayTemplateAttributes,
  assaysDesign,
  type CampaignAttributes,
  designerStart,
  type RecordEnvelope,
} from '@ailab/schema';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { readAnswer } from '../lib/assays.ts';
import { recordsQuery } from '../queries.ts';
import { RecordSearch } from './RecordSearch.tsx';

/**
 * Designing an experiment from an assay template on screen (plan 017b, UX review 2026-10-02 #1):
 * the template's essential inputs, what is still missing and the plates and wells as you answer
 * (assays.design), then one Draft that makes the experiment and its plate map (designer.start).
 */

type Essential = AssayTemplateAttributes['essentials'][number];
type Answer = string | number | string[] | { value: string; unit: string };

const SUBJECT_KINDS = ['sample', 'entity', 'container'];

export function AssayTemplateBlocks({ record }: { record: RecordEnvelope }) {
  const [open, setOpen] = useState(false);
  if (record.status !== 'active') return null;
  return open ? (
    <DesignForm template={record} onClose={() => setOpen(false)} />
  ) : (
    <section className="block" aria-label="Design an experiment">
      <header>
        <h2>Design an experiment</h2>
      </header>
      <div className="body">
        <p className="muted">
          Answer what this template asks; the experiment and its plate map are drafted for you to
          check and confirm.
        </p>
        <div className="toolbar">
          <button type="button" className="btn primary" onClick={() => setOpen(true)}>
            Design an experiment
          </button>
        </div>
      </div>
    </section>
  );
}

function DesignForm({ template, onClose }: { template: RecordEnvelope; onClose: () => void }) {
  const t = template.attributes as AssayTemplateAttributes;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const campaigns = useQuery(recordsQuery({ kind: 'campaign', status: 'active' })).data ?? [];
  const [campaign, setCampaign] = useState<string>();
  const [aim, setAim] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const aims = (
    campaigns.find((c) => c.id === campaign)?.attributes as CampaignAttributes | undefined
  )?.aims;

  const answers: Record<string, Answer> = {};
  for (const e of t.essentials) {
    const chosen = picked[e.id] ?? [];
    const text = texts[e.id]?.trim() ?? '';
    if (e.input === 'subjects') {
      if (chosen.length) answers[e.id] = chosen;
      else if (/^\d+$/.test(text) && Number(text) > 0) answers[e.id] = Number(text);
    } else if (text) answers[e.id] = readAnswer(text);
  }
  const design = useQuery({
    queryKey: ['assays', 'design', template.id, template.version, answers],
    queryFn: () =>
      api.run(assaysDesign, { template: template.id, version: template.version, answers, show: 0 }),
    placeholderData: (previous) => previous,
    retry: false,
  });
  const start = useMutation({
    mutationFn: () =>
      api.run(designerStart, {
        template: template.id,
        version: template.version,
        campaign: campaign as string,
        ...(aim ? { aim } : {}),
        answers,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['records'] });
      await navigate({ to: '/records/$id', params: { id: result.experiment.id } });
    },
  });
  const missing = design.data?.missing ?? [];
  const totals = design.data?.totals;
  return (
    <section className="block" aria-label="Design an experiment">
      <header>
        <h2>Design an experiment</h2>
        {design.data && (
          <span className={`state ${missing.length ? 'warn-ink' : 'ok-ink'}`}>
            {missing.length ? `${missing.length} to answer` : '✓ everything answered'}
          </span>
        )}
      </header>
      <div className="body">
        <form
          className="form-rows"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <div className="form-row">
            <span className="name">Campaign</span>
            <span className="control">
              <RecordSearch
                records={campaigns}
                value={campaign}
                onChange={(id) => {
                  setCampaign(id);
                  setAim('');
                }}
                label="Campaign"
                empty="choose the campaign it serves"
              />
            </span>
          </div>
          {aims && aims.length > 0 && (
            <label className="form-row">
              <span className="name">Aim</span>
              <span className="control">
                <select className="field" value={aim} onChange={(e) => setAim(e.target.value)}>
                  <option value="">none in particular</option>
                  {aims.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.text}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
          {t.essentials.map((e) =>
            e.input === 'subjects' ? (
              <SubjectsRow
                key={e.id}
                essential={e}
                chosen={picked[e.id] ?? []}
                setChosen={(ids) => setPicked({ ...picked, [e.id]: ids })}
                count={texts[e.id] ?? ''}
                setCount={(text) => setTexts({ ...texts, [e.id]: text })}
              />
            ) : (
              <label className="form-row" key={e.id}>
                <span className="name">{e.label}</span>
                <span className="control">
                  <input
                    className="field"
                    type="text"
                    value={texts[e.id] ?? ''}
                    onChange={(x) => setTexts({ ...texts, [e.id]: x.target.value })}
                    placeholder="a number, or a number with its unit"
                  />
                </span>
              </label>
            ),
          )}
          {design.error ? (
            <p className="error-text">{design.error.message}</p>
          ) : (
            design.data && (
              <div className="design-preview">
                {totals ? (
                  <p>
                    {totals.conditions} {totals.conditions === 1 ? 'condition' : 'conditions'} on{' '}
                    {totals.plates} {totals.plates === 1 ? 'plate' : 'plates'} per run;{' '}
                    {totals.totalWells} wells in all.
                  </p>
                ) : (
                  <p className="muted">Plates and wells are worked out once it is answered.</p>
                )}
                {missing.length > 0 && (
                  <p className="muted">
                    Still to answer: {missing.map((m) => m.label).join(', ')}.
                  </p>
                )}
              </div>
            )
          )}
          {start.error && <p className="error-text">{start.error.message}</p>}
          <div className="toolbar">
            <button
              type="submit"
              className="btn primary"
              disabled={!campaign || missing.length > 0 || !design.data || start.isPending}
            >
              Draft the experiment
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
          <p className="muted">
            Everything is drafted for you to check: the experiment, and its plate map when the
            template has a layout. Nothing is confirmed until you confirm it.
          </p>
        </form>
      </div>
    </section>
  );
}

function SubjectsRow({
  essential,
  chosen,
  setChosen,
  count,
  setCount,
}: {
  essential: Extract<Essential, { input: 'subjects' }>;
  chosen: string[];
  setChosen: (ids: string[]) => void;
  count: string;
  setCount: (text: string) => void;
}) {
  const kinds = essential.kinds ?? SUBJECT_KINDS;
  const records = useQueries({
    queries: kinds.map((kind) => recordsQuery({ kind })),
    combine: (results) =>
      results.flatMap((r) => r.data ?? []).filter((r) => r.status !== 'archived'),
  });
  const byId = new Map(records.map((r) => [r.id, r]));
  const left = records.filter((r) => !chosen.includes(r.id));
  return (
    <div className="form-row">
      <span className="name">{essential.label}</span>
      <span className="control">
        {chosen.length > 0 && (
          <ul className="plain chosen-subjects">
            {chosen.map((id) => (
              <li key={id}>
                <Link to="/records/$id" params={{ id }}>
                  {byId.get(id)?.label ?? id}
                </Link>{' '}
                <span className="code">{byId.get(id)?.name}</span>{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setChosen(chosen.filter((c) => c !== id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {(essential.max === undefined || chosen.length < essential.max) && (
          <RecordSearch
            records={left}
            value={undefined}
            onChange={(id) => id && setChosen([...chosen, id])}
            label={`Add to ${essential.label}`}
            empty="add one"
          />
        )}
        {chosen.length === 0 && (
          <span className="muted">
            {' '}
            or how many:{' '}
            <input
              className="field short"
              type="text"
              inputMode="numeric"
              aria-label={`How many: ${essential.label}`}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </span>
        )}
      </span>
    </div>
  );
}
