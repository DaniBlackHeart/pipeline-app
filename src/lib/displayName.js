// Single rule for "what do we call this person," used everywhere a name is
// displayed — header, Team roster, assignee dropdowns, comments, activity
// log. Nickname wins if set (it's the whole point of having one); falls
// back to full name, then email. A profile's full_name defaults to the
// person's email at signup (see schema.sql's handle_new_user()), so the
// email fallback here is mostly a defensive last resort, not the common case.
export function getDisplayName(profile, fallback = 'Someone') {
  if (!profile) return fallback
  const nickname = profile.nickname?.trim()
  if (nickname) return nickname
  const fullName = profile.full_name?.trim()
  if (fullName) return fullName
  return profile.email || fallback
}
