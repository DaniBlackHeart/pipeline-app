// Shared helpers for the MFA backup-code endpoints. Not a route itself —
// leading underscore excludes it from Vercel's route discovery.
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const CODE_COUNT = 10
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L — easy to misread when handwritten

function randomCode() {
  const bytes = randomBytes(10)
  let raw = ''
  for (let i = 0; i < 10; i++) raw += CODE_CHARS[bytes[i] % CODE_CHARS.length]
  return `${raw.slice(0, 5)}-${raw.slice(5)}` // e.g. "7K4PQ-9RXH2"
}

function hashCode(code, salt) {
  return scryptSync(code, salt, 64).toString('hex')
}

// Normalizes user input so it doesn't matter whether they typed the
// dash, extra spaces, or lowercase letters — used consistently at both
// generation and verification time so the two always agree on what's
// actually being hashed.
export function normalizeCode(input) {
  return (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Returns { plaintextCodes: string[], rows: [{ salt, code_hash }] } —
// plaintextCodes are the dashed, human-readable form shown to the user
// exactly once and never stored anywhere; rows hash the *normalized*
// form of each one, matching what verification normalizes user input to.
export function generateBackupCodes() {
  const plaintextCodes = Array.from({ length: CODE_COUNT }, randomCode)
  const rows = plaintextCodes.map((code) => {
    const salt = randomBytes(16).toString('hex')
    return { salt, code_hash: hashCode(normalizeCode(code), salt) }
  })
  return { plaintextCodes, rows }
}

export function codeMatchesHash(inputCode, salt, storedHash) {
  const candidateHash = hashCode(normalizeCode(inputCode), salt)
  const a = Buffer.from(candidateHash, 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
