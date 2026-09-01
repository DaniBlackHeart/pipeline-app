import { supabase } from './supabase'

// Applies a template's items to a project: inserts one task per item
// (title, description, start date defaulted to today, appended after
// the project's existing tasks in the same order the template has them),
// then -- for any item whose suggested role has a real person picked in
// roleAssignments -- adds that person as a task_assignees row with that
// same role label, exactly as picking them from a task's own "Assigned
// members" card would (including notifying them, since that's a normal
// task_assignees insert and the existing notify trigger doesn't care how
// the row got there).
//
// One task at a time (not a single bulk insert) specifically so each
// task's own id is known immediately for its assignee insert, without
// depending on insert-order guarantees from a multi-row insert.
//
// roleAssignments: { [role_label]: userId }. An item with no role_label,
// or whose role_label has no picked member, is created with no assignee
// -- still added to the task list, just left for someone to claim
// manually, same as any other unassigned task.
export async function applyTemplateToProject({ templateId, projectId, orgId, existingTaskCount, roleAssignments, createdBy }) {
  const { data: items, error: itemsError } = await supabase
    .from('task_template_items')
    .select('title, role_label, description')
    .eq('template_id', templateId)
    .order('position', { ascending: true })

  if (itemsError) return { error: itemsError, taskCount: 0 }
  if (!items || items.length === 0) return { error: null, taskCount: 0 }

  const today = new Date().toISOString().slice(0, 10)
  let created = 0

  for (const [index, item] of items.entries()) {
    const { data: inserted, error: insertError } = await supabase
      .from('tasks')
      .insert({
        project_id: projectId,
        org_id: orgId,
        title: item.title,
        description: item.description || null,
        start_date: today,
        position: existingTaskCount + index,
        created_by: createdBy,
      })
      .select('id')
      .single()

    if (insertError) return { error: insertError, taskCount: created }
    created += 1

    const userId = item.role_label && roleAssignments[item.role_label]
    if (userId) {
      const { error: assigneeError } = await supabase.from('task_assignees').insert({
        task_id: inserted.id,
        user_id: userId,
        role_label: item.role_label,
        org_id: orgId,
      })
      // The task itself is already created at this point -- don't fail
      // the whole apply over one assignee insert; the task can still be
      // assigned by hand from its own page afterward.
      if (assigneeError) return { error: assigneeError, taskCount: created, partial: true }
    }
  }

  return { error: null, taskCount: created }
}
