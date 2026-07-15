// Local-date key, e.g. "2026-07-15" — used to bucket items by day regardless
// of the time-of-day portion of their timestamp.
export function dateKey(d) {
  // Plain "date" columns (e.g. Postgres `date` type, like due_date) already
  // arrive as an exact "YYYY-MM-DD" string. Return it as-is rather than
  // routing through `new Date()`, which treats bare date strings as UTC
  // midnight and can shift the day backwards for timezones behind UTC.
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d
  }
  const date = d instanceof Date ? d : new Date(d)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayKey() {
  return dateKey(new Date())
}

// Builds a 6-week grid (42 days) for the given month, starting on Sunday,
// so the layout never reflows between months with 4, 5, or 6 visible weeks.
export function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1)
  const startOffset = firstOfMonth.getDay() // 0 = Sunday
  const gridStart = new Date(year, month, 1 - startOffset)

  const days = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    days.push(d)
  }
  return days
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
