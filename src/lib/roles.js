// The fixed set of roles a project or task can have someone assigned to.
// One fixed row per role, each with its own "choose a member" dropdown --
// not free text, not a per-assignment dropdown of its own. Used on both
// task and project creation forms, and on each one's own detail page.
export const QUICK_ROLES = ['Graphics Designer', 'Project Manager', 'Developer']

// A person can only hold one of the three role slots at a time -- the
// underlying *_assignees tables key on (project_id/task_id, user_id), so
// the same person in two role rows would violate that primary key. This
// takes a role->userId mapping and "moves" the person: setting a role to
// someone who already holds a different role clears them from the old
// one, rather than leaving both set and failing later at insert time.
export function reassignRole(prevMapping, role, userId) {
  const next = { ...prevMapping, [role]: userId }
  if (userId) {
    for (const r of QUICK_ROLES) {
      if (r !== role && next[r] === userId) next[r] = ''
    }
  }
  return next
}
