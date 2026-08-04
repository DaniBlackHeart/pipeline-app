// The fixed set of roles a task can have someone assigned to. Used two
// ways:
// - Task Assigned Members (creation and the task's own page): one fixed
//   row per role, each with its own "choose a member" dropdown -- not
//   free text, not a per-assignment dropdown of its own.
// - Project Assigned members: still a free-text "Role (optional)" field,
//   these just show up as <datalist> suggestions there.
export const QUICK_ROLES = ['Graphics Designer', 'Project Manager', 'Developer']
