const PRIORITY_MAP = {
  urgent: { bg: 'var(--tally-alert-soft)', color: 'var(--tally-alert)', label: 'Urgent' },
  high: { bg: 'var(--tally-progress-soft)', color: 'var(--tally-progress)', label: 'High' },
  medium: { bg: 'transparent', color: 'var(--ink-muted)', label: 'Medium', bordered: true },
  low: { bg: 'transparent', color: 'var(--ink-muted)', label: 'Low' },
}

export default function PriorityBadge({ priority }) {
  const info = PRIORITY_MAP[priority] || PRIORITY_MAP.medium
  return (
    <span
      className="inline-flex items-center text-xs font-mono uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0"
      style={{
        background: info.bg,
        color: info.color,
        border: info.bordered ? '1px solid var(--border)' : 'none',
      }}
    >
      {info.label}
    </span>
  )
}
