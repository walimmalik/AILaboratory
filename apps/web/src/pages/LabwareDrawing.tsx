import { LabwareTypeAttributes } from '@ailab/schema';
import { type Section, type TopView, topView, wellSection } from '../lib/labware-drawing.ts';

const fmt = (mm: number) => `${Number(mm.toFixed(2))} mm`;

/**
 * A labware type drawn to scale in millimetres: from above (outer size, wells with their names) and
 * one well cut through its centre (opening, taper, depth, bottom, and how far the maximum volume
 * fills it). What the record doesn't give is drawn dashed and listed under the drawings.
 */
export function LabwareDrawing({ attributes }: { attributes: Record<string, unknown> }) {
  const parsed = LabwareTypeAttributes.safeParse(attributes);
  if (!parsed.success) return null;
  const top = topView(parsed.data);
  const section = wellSection(parsed.data);
  const notes = [
    ...('missing' in top ? [top.missing] : top.notes),
    ...('missing' in section ? [section.missing] : section.notes),
  ];
  const anyDrawn =
    ('missing' in top ? false : top.sizeDrawn || top.positionsDrawn || top.wellSizeDrawn) ||
    ('missing' in section ? false : !section.bottom);
  return (
    <section className="block" aria-label="Drawing">
      <header>
        <h2>Drawing</h2>
        <span className="state muted">to scale, in mm</span>
      </header>
      <div className="body">
        <div className="drawings">
          {'missing' in top ? null : <PlateFromAbove view={top} />}
          {'missing' in section ? null : <WellCutaway section={section} />}
        </div>
        {notes.length > 0 && (
          <ul className="drawing-notes muted">
            {anyDrawn && (
              <li>Dashed lines are drawn for the picture, not taken from the record.</li>
            )}
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PlateFromAbove({ view }: { view: TopView }) {
  const { length, width, wells, pitch } = view;
  const label = Math.min(Math.max((pitch ?? 9) * 0.5, 1.6), 3.2);
  const margin = { left: label * 2.6, top: label * 2.4, right: 3, bottom: label * 3.4 };
  const every = (count: number) => (count > 24 ? 4 : count > 12 ? 2 : 1);
  const rowLabels = new Map<number, number>();
  const columnLabels = new Map<number, number>();
  for (const w of wells) {
    if (w.column === 0 && w.row % every(view.rows) === 0) rowLabels.set(w.row, w.y);
    if (w.row === 0 && (w.column + 1) % every(view.columns) === 0) columnLabels.set(w.column, w.x);
  }
  const viewBox = `${-margin.left} ${-margin.top} ${length + margin.left + margin.right} ${width + margin.top + margin.bottom}`;
  return (
    <figure className="drawing top-view">
      <svg viewBox={viewBox} role="img" aria-label={`From above, ${fmt(length)} by ${fmt(width)}`}>
        <rect
          className={view.sizeDrawn ? 'outline drawn' : 'outline'}
          x={0}
          y={0}
          width={length}
          height={width}
          rx={Math.min(length, width) * 0.03}
        />
        {wells.map((w) => {
          const cls = view.positionsDrawn || view.wellSizeDrawn ? 'well drawn' : 'well';
          return w.shape === 'circular' ? (
            <circle key={w.name} className={cls} cx={w.x} cy={w.y} r={w.xSize / 2}>
              <title>{w.name}</title>
            </circle>
          ) : (
            <rect
              key={w.name}
              className={cls}
              x={w.x - w.xSize / 2}
              y={w.y - w.ySize / 2}
              width={w.xSize}
              height={w.ySize}
            >
              <title>{w.name}</title>
            </rect>
          );
        })}
        {[...rowLabels].map(([row, y]) => (
          <text
            key={`r${row}`}
            x={-label * 1.2}
            y={y}
            fontSize={label}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {wells.find((w) => w.row === row && w.column === 0)?.name.replace(/\d+$/, '')}
          </text>
        ))}
        {[...columnLabels].map(([column, x]) => (
          <text
            key={`c${column}`}
            x={x}
            y={-label * 1.1}
            fontSize={label}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {column + 1}
          </text>
        ))}
        <text
          x={length / 2}
          y={width + label * 2}
          fontSize={label}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {fmt(length)} × {fmt(width)}
          {pitch ? ` · wells ${fmt(pitch)} apart` : ''}
        </text>
      </svg>
      <figcaption>From above, A1 at the back left</figcaption>
    </figure>
  );
}

function WellCutaway({ section }: { section: Section }) {
  const { top, base, depth, bottom, fill } = section;
  const r = bottom === 'round' || bottom === 'v' ? base / 2 : 0;
  const straight = Math.max(depth - r, 0);
  const walls =
    bottom === 'round'
      ? `M ${-top / 2} 0 L ${-base / 2} ${straight} A ${r} ${r} 0 0 0 ${base / 2} ${straight} L ${top / 2} 0`
      : bottom === 'v'
        ? `M ${-top / 2} 0 L ${-base / 2} ${straight} L 0 ${depth} L ${base / 2} ${straight} L ${top / 2} 0`
        : `M ${-top / 2} 0 L ${-base / 2} ${depth} L ${base / 2} ${depth} L ${top / 2} 0`;
  const widthAt = (y: number) => top + (base - top) * (y / depth);
  const label = Math.max(top, depth) / 14;
  const margin = label * 3;
  const liquid = fill
    ? (() => {
        const y = depth - fill.height;
        const w = widthAt(y);
        return `M ${-w / 2} ${y} L ${-base / 2} ${depth} L ${base / 2} ${depth} L ${w / 2} ${y} Z`;
      })()
    : undefined;
  const half = Math.max(top, base) / 2;
  const left = fill ? label * 9 : margin;
  const viewBox = `${-half - left} ${-margin * 1.2} ${2 * half + left + label * 10} ${depth + margin * 2.2}`;
  return (
    <figure className="drawing well-view">
      <svg viewBox={viewBox} role="img" aria-label={`One well, ${fmt(depth)} deep`}>
        {liquid && <path className="liquid" d={liquid} />}
        <path className={bottom ? 'wall' : 'wall drawn'} d={walls} />
        <text x={0} y={-label * 1.2} fontSize={label} textAnchor="middle">
          {fmt(top)}
        </text>
        <line className="dim" x1={half + label} y1={0} x2={half + label} y2={depth} />
        <text x={half + label * 1.6} y={depth / 2} fontSize={label} dominantBaseline="central">
          {fmt(depth)} deep
        </text>
        {base !== top && (
          <text x={0} y={depth + label * 1.6} fontSize={label} textAnchor="middle">
            base {fmt(base)}
          </text>
        )}
        {fill && (
          <text
            x={-half - label * 0.6}
            y={depth - fill.height}
            fontSize={label}
            textAnchor="end"
            dominantBaseline="central"
            className="liquid-label"
          >
            <tspan x={-half - label * 0.6} dy={-label * 0.6}>
              {fill.volume}
            </tspan>
            <tspan x={-half - label * 0.6} dy={label * 1.2}>
              at {fmt(fill.height)}
            </tspan>
          </text>
        )}
      </svg>
      <figcaption>
        One well, cut through the centre{bottom ? `, ${bottomWords[bottom]}` : ''}
      </figcaption>
    </figure>
  );
}

const bottomWords = { flat: 'flat bottom', round: 'round (U) bottom', v: 'V bottom' } as const;
