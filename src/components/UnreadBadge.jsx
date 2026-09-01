// Same visual language as NotificationBell's existing badge -- reused
// here rather than redefined, so "unread" looks like the same thing
// everywhere in the app instead of two subtly different styles.
// variant="mention" uses the amber "in progress" accent instead of the
// red "alert" one, so a conversation where you were actually @mentioned
// reads as distinct from one that just has ordinary unread traffic.
export default function UnreadBadge({ count, variant = 'default', className = '' }) {
  if (!count) return null
  const colors = variant === 'mention'
    ? { background: 'var(--tally-progress)', color: 'var(--panel)' }
    : { background: 'var(--tally-alert)', color: 'var(--panel)' }
  return (
    <span
      className={`flex-shrink-0 h-4 min-w-[16px] px-1 rounded-full text-[10px] font-mono flex items-center justify-center ${className}`}
      style={colors}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}
