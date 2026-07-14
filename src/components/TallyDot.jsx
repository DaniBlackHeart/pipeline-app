const STATUS_MAP = {
  active: { color: 'var(--tally-progress)', label: 'Active' },
  in_progress: { color: 'var(--tally-progress)', label: 'In progress' },
  on_hold: { color: 'var(--tally-alert)', label: 'On hold' },
  todo: { color: 'var(--ink-muted)', label: 'To do' },
  completed: { color: 'var(--tally-done)', label: 'Completed' },
  done: { color: 'var(--tally-done)', label: 'Done' },
  archived: { color: 'var(--ink-muted)', label: 'Archived' },
}

export default function TallyDot({ status, showLabel = true }) {
  const info = STATUS_MAP[status] || { color: 'var(--ink-muted)', label: status }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--ink-muted)' }}>
      <span
        className="inline-block h-2 w-2 rounded-full flex-shrink-0"
        style={{ background: info.color }}
        aria-hidden="true"
      />
      {showLabel && <span className="font-mono text-xs uppercase tracking-wide">{info.label}</span>}
    </span>
  )
}
