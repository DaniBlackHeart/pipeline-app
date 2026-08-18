// Password strength policy, shared by owner signup and the invite/reset
// "set password" flow, so both are held to the same bar.
//
// Deliberately favors length over arbitrary composition rules (in line with
// current NIST guidance) rather than forcing "must contain a symbol" — but
// still blocks the specific things that make a password trivially guessable:
// too short, a known-common password, simple repeated/sequential runs, or
// the account's own email/name embedded in it.

export const MIN_PASSWORD_LENGTH = 10

// Not exhaustive — a deliberately short list of the passwords that show up
// at the top of every real-world breach dump, plus obvious app-flavored
// variants. This is a floor, not a full breach-database check.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  '12345678', '123456789', '1234567890', '11111111', '00000000',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'asdfghjkl', 'zxcvbnm12',
  'letmein', 'letmein123', 'welcome1', 'welcome123', 'changeme', 'changeme123',
  'trustno1', 'whatever1', 'iloveyou', 'iloveyou1', 'admin1234', 'administrator',
  'sunshine1', 'princess1', 'football1', 'baseball1', 'dragon123', 'monkey123',
  'starwars1', 'superman1', 'shadow123', 'freedom123', 'master123', 'login123',
  'abc123456', 'abcd1234', '1q2w3e4r', '1qaz2wsx', 'passwort', 'contraseña',
])

function hasSimpleRepeatedOrSequentialRun(password) {
  const lower = password.toLowerCase()

  // All one repeated character, e.g. "aaaaaaaaaa".
  if (/^(.)\1+$/.test(lower)) return true

  // A run of 6+ ascending or descending characters (numeric or alphabetic),
  // e.g. "12345678", "87654321", "abcdefgh".
  let ascRun = 1
  let descRun = 1
  for (let i = 1; i < lower.length; i++) {
    const prev = lower.charCodeAt(i - 1)
    const curr = lower.charCodeAt(i)
    ascRun = curr === prev + 1 ? ascRun + 1 : 1
    descRun = curr === prev - 1 ? descRun + 1 : 1
    if (ascRun >= 6 || descRun >= 6) return true
  }
  return false
}

function containsPersonalInfo(password, { email, fullName } = {}) {
  const lower = password.toLowerCase().replace(/[^a-z0-9]/g, '')

  const candidates = []
  if (email) {
    const local = email.split('@')[0]
    if (local) candidates.push(local.toLowerCase().replace(/[^a-z0-9]/g, ''))
  }
  if (fullName) {
    for (const part of fullName.toLowerCase().split(/\s+/)) {
      const cleaned = part.replace(/[^a-z0-9]/g, '')
      if (cleaned) candidates.push(cleaned)
    }
  }

  return candidates.some((c) => c.length >= 4 && lower.includes(c))
}

/**
 * Evaluate a candidate password.
 * @param {string} password
 * @param {{email?: string, fullName?: string}} context
 * @returns {{
 *   score: number,          // 0-4, for the visual meter only
 *   label: string,
 *   tone: 'alert'|'progress'|'done',
 *   blockingIssues: string[], // must be empty for the password to be accepted
 *   isValid: boolean,
 *   checklist: { label: string, met: boolean }[]
 * }}
 */
export function evaluatePassword(password, context = {}) {
  const pw = password || ''
  const blockingIssues = []

  const meetsLength = pw.length >= MIN_PASSWORD_LENGTH
  if (!meetsLength) {
    blockingIssues.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  const isCommon = COMMON_PASSWORDS.has(pw.toLowerCase())
  if (isCommon) {
    blockingIssues.push('That password is too common — pick something less predictable.')
  }

  const isSimplePattern = pw.length > 0 && hasSimpleRepeatedOrSequentialRun(pw)
  if (isSimplePattern) {
    blockingIssues.push('Avoid simple repeated or sequential characters.')
  }

  const hasPersonalInfo = pw.length > 0 && containsPersonalInfo(pw, context)
  if (hasPersonalInfo) {
    blockingIssues.push("Don't use your name or email in your password.")
  }

  // Visual meter score — variety and extra length are rewarded here even
  // though they're not required, to nudge people toward stronger passwords.
  const hasLower = /[a-z]/.test(pw)
  const hasUpper = /[A-Z]/.test(pw)
  const hasDigit = /[0-9]/.test(pw)
  const hasSymbol = /[^a-zA-Z0-9]/.test(pw)
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length

  let score = 0
  if (pw.length >= MIN_PASSWORD_LENGTH) score++
  if (pw.length >= 14) score++
  if (classes >= 2) score++
  if (classes >= 3 && pw.length >= 12) score++
  if (isCommon || isSimplePattern) score = Math.min(score, 1)
  score = Math.max(0, Math.min(4, pw.length === 0 ? 0 : score))

  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
  const tones = ['alert', 'alert', 'progress', 'progress', 'done']

  return {
    score,
    label: labels[score],
    tone: tones[score],
    blockingIssues,
    isValid: blockingIssues.length === 0,
    checklist: [
      { label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: meetsLength },
      { label: 'Not a common password', met: pw.length > 0 && !isCommon },
      { label: 'No simple repeated or sequential runs', met: pw.length > 0 && !isSimplePattern },
      { label: "Doesn't contain your name or email", met: pw.length > 0 && !hasPersonalInfo },
    ],
  }
}
