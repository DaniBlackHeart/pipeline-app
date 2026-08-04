// Quick-pick role suggestions for the "Role (optional)" field wherever
// someone gets assigned to a project or task (project_assignees /
// task_assignees). These are suggestions, not a locked enum -- the field
// stays free text (via <datalist>), so a one-off custom label still works.
export const QUICK_ROLES = [
  { title: 'Founder', description: '' },
  { title: 'Account Manager', description: 'Manages client relationships, sales, and overall business strategy.' },
  { title: 'The Marketing Generalist', description: 'Handles SEO, PPC ad setups, and social media posting.' },
  { title: 'The Creative All-Rounder', description: 'Creates graphic designs, writes copy, and edits simple videos.' },
  { title: 'The Full-Stack Developer', description: 'Builds websites, fixes technical bugs, and manages hosting.' },
]
