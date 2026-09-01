// Client side of api/auth-lockout.js. Unlike every other api/*.js
// wrapper in src/lib, this one deliberately doesn't attach a session
// token -- it runs before login (or account creation) succeeds, so
// there isn't one yet.

async function callFn(body) {
  const res = await fetch('/api/auth-lockout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => ({}))
}

// Returns { locked, retryAfterSeconds? }. Call before attempting sign-in.
// Fails open (locked: false) on any network/parse error -- an outage in
// this specific endpoint should never block a legitimate login.
export async function checkLoginLockout(email) {
  try {
    const data = await callFn({ action: 'check', email })
    return { locked: !!data.locked, retryAfterSeconds: data.retryAfterSeconds }
  } catch {
    return { locked: false }
  }
}

// Fire-and-forget -- call only after Supabase itself rejects a login
// attempt with invalid credentials, so successful logins and signup
// attempts never count against this. Never throws into the caller.
export function recordLoginFailure(email) {
  callFn({ action: 'record-failure', email }).catch(() => {})
}

// Returns { valid, reason? }. Call before signUp() during account
// creation -- catches a syntactically-fine-but-fake or can't-receive-mail
// address (see api/_emailValidation.js for what this does and doesn't
// check) before Supabase ever creates the account. Fails open (valid:
// true) on any network/parse error, same reasoning as checkLoginLockout
// above -- an outage in this endpoint should never block a real signup.
export async function validateEmailForSignup(email) {
  try {
    const data = await callFn({ action: 'validate-email', email })
    return { valid: data.valid !== false, reason: data.reason }
  } catch {
    return { valid: true }
  }
}
