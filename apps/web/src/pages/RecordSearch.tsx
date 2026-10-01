import { useId, useRef, useState } from 'react';

export interface PickerRecord {
  id: string;
  name: string;
  label: string;
}

/** How many matches the list shows; typing more narrows it. */
const SHOWN = 12;

/**
 * Picks one record by typing part of its label or readable name (review 2026-10-01 item 22): the
 * box shows the chosen record's label, the list each match's label (clipped, whole on hover) with
 * its name. Arrow keys move, Enter picks, Escape closes; emptying the box clears the choice.
 */
export function RecordSearch({
  records,
  value,
  onChange,
  label,
  empty,
}: {
  records: PickerRecord[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  label: string;
  /** What the empty box says, e.g. "any that fits". */
  empty: string;
}) {
  const chosen = records.find((r) => r.id === value);
  const [query, setQuery] = useState<string>();
  const [active, setActive] = useState(0);
  const list = useId();
  const box = useRef<HTMLInputElement>(null);
  const open = query !== undefined;
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = records
    .filter((r) => {
      const text = `${r.label} ${r.name}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .slice(0, SHOWN);
  const pick = (record: PickerRecord | undefined) => {
    onChange(record?.id);
    setQuery(undefined);
  };
  return (
    <span className="record-search">
      <input
        ref={box}
        className="field grow"
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${list}-${active}` : undefined}
        placeholder={chosen?.label ?? empty}
        title={chosen ? `${chosen.label} (${chosen.name})` : undefined}
        value={query ?? (chosen ? chosen.label : (value ?? ''))}
        onFocus={(e) => {
          setQuery('');
          setActive(0);
          e.currentTarget.select();
        }}
        onBlur={() => setQuery(undefined)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (e.target.value === '') onChange(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (matches[active]) pick(matches[active]);
          } else if (e.key === 'Escape') {
            setQuery(undefined);
          }
        }}
      />
      {chosen && <span className="mono muted">{chosen.name}</span>}
      {open && (
        <div className="record-search-list" id={list} role="listbox" aria-label={label}>
          {matches.map((r, i) => (
            <div
              key={r.id}
              id={`${list}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              title={r.label}
              // Picking happens before the box loses focus and closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="record-search-label">{r.label}</span>
              <span className="mono muted">{r.name}</span>
            </div>
          ))}
          {matches.length === 0 && <p className="muted">Nothing matches "{query}"</p>}
        </div>
      )}
    </span>
  );
}
