import { Link } from 'react-router-dom'
import { STATUS_MAP } from './TallyDot'

// Lightweight custom Gantt/timeline chart — no charting library. Bars are
// plain absolutely-positioned divs inside a relatively-positioned track,
// scaled as percentages of a shared date range (`bounds`), so it works the
// same way whether that range is a week or a year. No drag/resize/zoom —
// the existing Reports date-range preset picker above the tabs *is* the
// zoom control, since Timeline shares it with the other report tabs.
//
// `lanes`: [{ key, label, items }], where each item is already normalized
// to { id, label, status, href, start, end, tooltip } with `start`/`end`
// as "YYYY-MM-DD" strings (never null — callers fill in a same-day
// fallback before handing items to this component).
// `bounds`: { start, end } as "YYYY-MM-DD" strings, spanning the whole
// chart's date axis.

function toDays(dateKeyStr) {
  return Math.floor(new Date(`${dateKeyStr}T00:00:00`).getTime() / 86400000)
}

function statusColor(status) {
  return (STATUS_MAP[status] || { color: 'var(--ink-muted)' }).color
}

function computeBar(start, end, boundStartDays, boundEndDays, totalDays) {
  const s = Math.min(Math.max(toDays(start), boundStartDays), boundEndDays)
  const e = Math.min(Math.max(toDays(end), boundStartDays), boundEndDays)
  let left = ((s - boundStartDays) / totalDays) * 100
  // Floor the width so a single-day item is still visible as a sliver
  // rather than disappearing entirely on a multi-month axis.
  const width = Math.max(((Math.max(e, s) - s) / totalDays) * 100, 1.2)
  // Shift left rather than shrinking width when the floored width would
  // push the bar past the right edge (e.g. a single-day item that lands
  // on the very last day of the visible range) -- otherwise that item
  // renders with 0% width and silently disappears.
  if (left + width > 100) left = Math.max(0, 100 - width)
  return { left: `${left}%`, width: `${width}%` }
}

function buildTicks(bounds, count = 6) {
  const boundStartDays = toDays(bounds.start)
  const boundEndDays = toDays(bounds.end)
  const spanDays = Math.max(1, boundEndDays - boundStartDays)
  const showYear = spanDays > 400
  const ticks = []
  for (let i = 0; i <= count; i++) {
    const days = boundStartDays + Math.round((spanDays * i) / count)
    const d = new Date(days * 86400000)
    ticks.push({
      pct: (i / count) * 100,
      label: d.toLocaleDateString(undefined, showYear ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' }),
    })
  }
  return ticks
}

const LABEL_COL = 'w-36 sm:w-52'

export default function GanttChart({ lanes, bounds }) {
  const boundStartDays = toDays(bounds.start)
  const boundEndDays = toDays(bounds.end)
  const totalDays = Math.max(1, boundEndDays - boundStartDays)
  const ticks = buildTicks(bounds)

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: '640px' }}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`${LABEL_COL} flex-shrink-0`} />
          <div className="relative flex-1 h-4">
            {ticks.map((t, i) => (
              <span
                key={i}
                className="absolute text-[10px] font-mono whitespace-nowrap"
                style={{
                  left: `${t.pct}%`,
                  color: 'var(--ink-muted)',
                  transform: i === 0 ? 'none' : i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {lanes.map((lane) => (
          <div key={lane.key} className="mb-5 last:mb-0">
            <p className="text-xs font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>
              {lane.label} · {lane.items.length}
            </p>
            {lane.items.length === 0 ? (
              <p className="text-xs py-1" style={{ color: 'var(--ink-muted)' }}>Nothing in range.</p>
            ) : (
              <div className="space-y-1.5">
                {lane.items.map((item) => {
                  const bar = computeBar(item.start, item.end, boundStartDays, boundEndDays, totalDays)
                  return (
                    <div key={item.id} className="flex items-center gap-3">
                      <Link
                        to={item.href}
                        className={`${LABEL_COL} flex-shrink-0 flex items-center gap-1.5 min-w-0`}
                        title={item.tooltip}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                          style={{ background: statusColor(item.status) }}
                          aria-hidden="true"
                        />
                        <span className="text-xs truncate underline">{item.label}</span>
                      </Link>
                      <div className="relative flex-1 h-4 rounded" style={{ background: 'var(--panel-sunken)' }}>
                        <div
                          className="absolute top-0 h-4 rounded"
                          style={{ left: bar.left, width: bar.width, background: statusColor(item.status) }}
                          title={item.tooltip}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
