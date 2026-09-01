import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getDisplayName } from '../lib/displayName'
import { friendlyError } from '../lib/errorMessages'

// Lets someone pick one of the workspace's task templates, preview its
// task list, and optionally assign a real person to each suggested role
// the template uses. Purely a controlled picker -- it doesn't create
// anything itself; the parent reads `value` and decides when/how to
// actually apply it (see src/lib/taskTemplates.js's applyTemplateToProject,
// used both on an existing project's own page and at project-creation
// time in NewProject.jsx).
//
// value: { templateId, roleAssignments } -- roleAssignments is
// { [role_label]: userId }, one entry per distinct role_label found
// across the selected template's items.
export default function TemplatePicker({ orgId, members, value, onChange }) {
  const [templates, setTemplates] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('task_templates')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name', { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(friendlyError(fetchError))
        setTemplates(data || [])
        setLoading(false)
      })
  }, [orgId])

  const loadItems = useCallback(async (templateId) => {
    if (!templateId) {
      setItems([])
      return
    }
    const { data, error: fetchError } = await supabase
      .from('task_template_items')
      .select('id, title, role_label')
      .eq('template_id', templateId)
      .order('position', { ascending: true })
    if (fetchError) {
      setError(friendlyError(fetchError))
      return
    }
    setItems(data || [])
  }, [])

  const handleTemplateChange = async (templateId) => {
    onChange({ templateId, roleAssignments: {} })
    await loadItems(templateId)
  }

  const handleRoleAssignmentChange = (role, userId) => {
    onChange({ ...value, roleAssignments: { ...value.roleAssignments, [role]: userId } })
  }

  const distinctRoles = [...new Set(items.map((i) => i.role_label).filter(Boolean))]

  if (loading) return <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading templates…</p>

  if (templates.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
        No task templates yet — create one from Task Templates in the account menu.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert-text)' }} role="alert">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="template-picker" className="block text-sm font-medium mb-1">Template</label>
        <select
          id="template-picker"
          value={value.templateId || ''}
          onChange={(e) => handleTemplateChange(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          <option value="">Choose a template…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {items.length > 0 && (
        <>
          <ul className="text-sm space-y-1 rounded-md border p-3" style={{ borderColor: 'var(--border)' }}>
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{item.title}</span>
                {item.role_label && (
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>{item.role_label}</span>
                )}
              </li>
            ))}
          </ul>

          {distinctRoles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
                Assign each role (optional — leave unassigned to fill in later)
              </p>
              {distinctRoles.map((role) => (
                <div key={role} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm font-medium flex-shrink-0">{role}</span>
                  <label htmlFor={`template-role-${role}`} className="sr-only">{role}</label>
                  <select
                    id={`template-role-${role}`}
                    value={value.roleAssignments[role] || ''}
                    onChange={(e) => handleRoleAssignmentChange(role, e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <option value="">Choose a member…</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{getDisplayName(m, 'Member')}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
