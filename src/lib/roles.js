// The fixed set of roles a project or task can have someone assigned to.
// One fixed row per role, each with its own "choose a member" dropdown --
// not free text, not a per-assignment dropdown of its own. Used on both
// task and project creation forms, and on each one's own detail page.
export const QUICK_ROLES = ['Graphics Designer', 'Project Manager', 'Developer']

// A person can hold more than one of the three role slots at once -- e.g.
// a solo freelancer working a project alone. The underlying *_assignees
// tables key on (project_id/task_id, user_id, role_label), so the same
// person can have one row per role without conflicting. This just applies
// a role->userId mapping update; no "move" needed since setting a role no
// longer has to clear whatever other role that person already holds.
export function reassignRole(prevMapping, role, userId) {
  return { ...prevMapping, [role]: userId }
}
