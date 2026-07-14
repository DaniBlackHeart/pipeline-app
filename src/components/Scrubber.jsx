// Scrubber: a timeline-style progress indicator instead of a plain bar.
// Tick marks read like a timeline ruler; the playhead marks current progress;
// the fill color reads as a tally light (amber = in progress, teal = done, red = overdue).
export default function Scrubber({ percent = 0, tone = 'progress', label }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const toneVar = {
    progress: 'var(--tally-progress)',
    done: 'var(--tally-done)',
    alert: 'var(--tally-alert)',
  }[tone] || 'var(--tally-progress)'

  const ticks = Array.from({ length: 11 }, (_, i) => i * 10)

  return (
    <div className="w-full" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100} aria-label={label || 'Progress'}>
      <div className="relative h-2.5 rounded-full" style={{ background: 'var(--panel-sunken)' }}>
        {/* tick marks */}
        <div className="absolute inset-0 flex justify-between px-px pointer-events-none">
          {ticks.map((t) => (
            <span
              key={t}
              className="w-px"
              style={{
                height: t % 50 === 0 ? '10px' : '6px',
                marginTop: t % 50 === 0 ? '-1px' : '1px',
                background: 'var(--border)',
              }}
            />
          ))}
        </div>
        {/* fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${clamped}%`, background: toneVar }}
        />
        {/* playhead */}
        <div
          className="absolute top-1/2 h-3.5 w-3.5 rounded-full border-2 shadow-sm transition-all duration-500"
          style={{
            left: `calc(${clamped}% - 7px)`,
            transform: 'translateY(-50%)',
            background: 'var(--panel)',
            borderColor: toneVar,
          }}
        />
      </div>
    </div>
  )
}
