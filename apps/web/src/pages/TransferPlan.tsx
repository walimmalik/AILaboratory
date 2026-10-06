import type { RecordEnvelope, TransferPlanAttributes } from '@ailab/schema';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatValue } from '../lib/format.ts';
import { recordQuery } from '../queries.ts';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const roleName = { source: 'Source', destination: 'Destination', intermediate: 'Intermediate' };

/** The saved movements in the plan, in the order the groups and transfers will run. */
export function TransferPlanBlocks({ record }: { record: RecordEnvelope }) {
  const a = record.attributes as Partial<TransferPlanAttributes>;
  const plates = Array.isArray(a.plates) ? a.plates : [];
  const groups = Array.isArray(a.groups) ? a.groups : [];
  const references = [
    ...plates.flatMap((plate) => [plate.container, plate.plateMap?.map.id]),
    ...groups.map((group) => group.instrument?.instrument),
  ].filter((id): id is string => !!id);
  const ids = [...new Set(references)];
  const found = useQueries({ queries: ids.map((id) => recordQuery(id)) });
  const names = new Map(ids.map((id, index) => [id, found[index]?.data?.label]));
  const plateNames = new Map(
    plates.map((plate, index) => [
      plate.id,
      plate.label || `${roleName[plate.role] ?? 'Plate'} plate ${index + 1}`,
    ]),
  );
  const place = (plate: string | undefined, well: string | undefined) =>
    `${plateNames.get(plate ?? '') ?? 'Unspecified plate'} · ${well || 'well not set'}`;
  const count = groups.reduce((total, group) => total + (group.transfers?.length ?? 0), 0);

  return (
    <section className="block" aria-label="Liquid transfers">
      <header>
        <h2>Liquid transfers</h2>
        <span className="state muted">
          {plural(count, 'transfer')} in {plural(groups.length, 'group')}
        </span>
      </header>
      <div className="body">
        {a.purpose && <p>{a.purpose}</p>}
        {plates.length > 0 && (
          <div>
            <h3 className="group-title">Plates and sources</h3>
            <ul className="plain">
              {plates.map((plate) => (
                <li key={plate.id}>
                  <b>{plateNames.get(plate.id)}</b>
                  <span className="muted"> · {plate.role}</span>
                  {plate.container && (
                    <>
                      {' · '}
                      <Link to="/records/$id" params={{ id: plate.container }}>
                        {names.get(plate.container) ?? 'Container'}
                      </Link>
                    </>
                  )}
                  {plate.plateMap && (
                    <>
                      {' · '}
                      <Link to="/records/$id" params={{ id: plate.plateMap.map.id }}>
                        {names.get(plate.plateMap.map.id) ?? 'Plate map'} plate{' '}
                        {plate.plateMap.plate}
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {groups.length === 0 ? (
          <p className="empty">No liquid transfers are in this plan yet.</p>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.id || groupIndex}>
              <h3 className="group-title">
                {group.label || `Transfer group ${groupIndex + 1}`}{' '}
                <span className="muted">({plural(group.transfers?.length ?? 0, 'transfer')})</span>
              </h3>
              <p className="muted">
                {group.instrument ? (
                  <Link to="/records/$id" params={{ id: group.instrument.instrument }}>
                    {group.device?.label || names.get(group.instrument.instrument) || 'Instrument'}
                  </Link>
                ) : (
                  'By hand'
                )}
                {group.reason && <> · {group.reason}</>}
              </p>
              {(group.transfers?.length ?? 0) > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">From</th>
                        <th scope="col">To</th>
                        <th scope="col">Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.transfers.map((transfer, index) => (
                        // Transfers have no saved ID, and their order is part of the plan.
                        // biome-ignore lint/suspicious/noArrayIndexKey: repeated identical movements still need separate rows
                        <tr key={`${group.id}-${index}`}>
                          <td>{place(transfer.from?.plate, transfer.from?.well)}</td>
                          <td>{place(transfer.to?.plate, transfer.to?.well)}</td>
                          <td className="q">{formatValue(transfer.volume)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))
        )}
        {a.notes && <p>{a.notes}</p>}
      </div>
    </section>
  );
}
