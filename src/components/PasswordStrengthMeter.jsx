import { evaluatePassword } from '../lib/passwordStrength'

const toneVar = {
  alert: 'var(--tally-alert)',
  progress: 'var(--tally-progress)',
  done: 'var(--tally-done)',
}

// Shown under a "new password" field on both the owner-signup form and the
// invite/reset "set password" form. Renders nothing until the person starts
// typing, so it doesn't clutter an empty form.
export default function PasswordStrengthMeter({ password, context }) {
  if (!password) return null

  const { score, label, tone, checklist } = evaluatePassword(password, context)
  const segments = [0, 1, 2, 3]

  return (
    <div className="mt-2 space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1" role="img" aria-label={`Password strength: ${label}`}>
          {segments.map((i) => (
            <div
              key={i}
              className="h-1.5 flex-1 rounded-full transition-colors duration-300"
              style={{ background: i < score ? toneVar[tone] : 'var(--panel-sunken)' }}
            />
          ))}
        </div>
        <span className="text-xs font-medium" style={{ color: toneVar[tone] }}>
          {label}
        </span>
      </div>

      <ul className="space-y-0.5">
        {checklist.map((item) => (
          <li
            key={item.label}
            className="text-xs flex items-center gap-1.5"
            style={{ color: item.met ? 'var(--ink-muted)' : 'var(--tally-alert)' }}
          >
            <span aria-hidden="true">{item.met ? '✓' : '·'}</span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
