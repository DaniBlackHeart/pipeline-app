import { dateKey } from './calendarUtils'

// Returns { start, end } as "YYYY-MM-DD" strings (or null for unbounded),
// built from local date components so a report run at 11pm never bleeds
// into the wrong day the way `toISOString()` would for non-UTC timezones.
export function getPresetRange(preset) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  switch (preset) {
    case 'this_month':
      return { start: dateKey(new Date(y, m, 1)), end: dateKey(now) }
    case 'last_month':
      return { start: dateKey(new Date(y, m - 1, 1)), end: dateKey(new Date(y, m, 0)) }
    case 'this_quarter': {
      const qStartMonth = Math.floor(m / 3) * 3
      return { start: dateKey(new Date(y, qStartMonth, 1)), end: dateKey(now) }
    }
    case 'this_year':
      return { start: dateKey(new Date(y, 0, 1)), end: dateKey(now) }
    case 'all_time':
    default:
      return { start: null, end: null }
  }
}

export const RANGE_PRESETS = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'this_year', label: 'This year' },
  { key: 'all_time', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

export function formatRangeLabel(start, end) {
  if (!start && !end) return 'All time'
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}
