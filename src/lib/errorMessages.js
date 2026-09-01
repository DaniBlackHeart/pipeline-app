// Maps raw Postgres/PostgREST error codes to plain-language text, so a
// failed insert/update/delete shows the user something readable instead
// of raw SQL ("duplicate key value violates unique constraint..."). This
// is deliberately scoped to genuine database errors only:
//
// - Supabase Auth errors (sign up, sign in, MFA enroll/verify/disable,
//   password reset) already come back with curated, user-appropriate
//   text of their own and are never passed through this function.
// - This app's own api/*.js endpoints (Google Calendar, Wise, MFA
//   recovery) throw plain Errors with messages already written for end
//   users -- also never passed through here.
//
// Errors with no `.code` at all (a plain JS Error, a network failure
// like "Failed to fetch", or anything from the two categories above if
// it were ever passed in by mistake) are shown as-is rather than
// genericized -- there's nothing raw-SQL-shaped to clean up, and
// genericizing an already-fine message would make things worse, not
// better.

// Auto-generated constraint names (Postgres's own <table>_<column>_check
// convention) aren't matched individually below -- relying on that
// implicit naming for every table would be fragile and drift easily if
// a table or column is ever renamed. Only constraints this codebase
// names explicitly are matched by name, because they were named on
// purpose to encode a real rule worth explaining. Everything else falls
// through to the per-code message, which is still a real improvement
// over the raw text, just less specific.
const NAMED_CONSTRAINT_MESSAGES = {
  invoices_must_link_to_one_check: 'An invoice must be linked to exactly one project or task — not both, not neither.',
  recurring_templates_must_link_to_one_check: 'A recurring invoice template must be linked to exactly one project or task — not both, not neither.',
  attachments_parent_type_check: "That attachment type isn't supported here.",
  clients_org_name_unique_idx: 'A client with that name already exists in this workspace.',
  attachments_kind_consistency: 'A link needs a URL, and an uploaded file needs a file — not both, not neither.',
  notifications_type_check: "That notification type isn't recognized.",
  project_assignees_user_role_unique: 'That person is already assigned to this exact role on this project.',
  task_assignees_user_role_unique: 'That person is already assigned to this exact role on this task.',
}

const CODE_MESSAGES = {
  23505: 'That already exists — try a different value.',
  23503: "That doesn't exist anymore, or was already removed.",
  23502: 'A required field is missing.',
  23514: "That value isn't allowed here.",
  42501: "You don't have permission to do that.",
  PGRST116: "Not found, or you don't have access.",
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

export function friendlyError(error) {
  if (!error) return ''

  // No .code at all -- not a raw Postgres/PostgREST error. Show as-is;
  // see the file header for why.
  if (!error.code) return error.message || GENERIC_MESSAGE

  // One of our own security-definer functions raised this deliberately
  // (e.g. the ticket-submission or share-view rate limit) -- a plain
  // `raise exception` in plpgsql defaults to this code, and the message
  // was written to be shown to a user already, so pass it through
  // rather than genericizing it.
  if (error.code === 'P0001') return error.message

  const rawMessage = error.message || ''
  const constraintMatch = rawMessage.match(/constraint "([a-z0-9_]+)"/i)
  if (constraintMatch && NAMED_CONSTRAINT_MESSAGES[constraintMatch[1]]) {
    return NAMED_CONSTRAINT_MESSAGES[constraintMatch[1]]
  }

  if (CODE_MESSAGES[error.code]) return CODE_MESSAGES[error.code]

  return GENERIC_MESSAGE
}
