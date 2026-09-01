import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errorMessages'

// Reusable "pick an existing client, or add a new one inline" control.
// Used wherever a project, standalone task, or invoice needs to link to a
// client (NewProject, TaskDetail, InvoiceForm) instead of typing a name by
// hand each time. Selecting or creating a client calls onSelect with the
// full client row ({id, name, company, website}), or null when cleared.
export default function ClientPicker({ orgId, value, onSelect, label = 'Client', required = true, id = 'client-picker' }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('clients')
      .select('id, name, company, website')
      .eq('org_id', orgId)
      .order('name', { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(friendlyError(fetchError))
        setClients(data || [])
        setLoading(false)
      })
  }, [orgId])

  const handleChange = (e) => {
    const selectedId = e.target.value
    if (selectedId === '__add_new__') {
      setAdding(true)
      return
    }
    onSelect(clients.find((c) => c.id === selectedId) || null)
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setError('')
    const { data: userData } = await supabase.auth.getUser()
    const { data: inserted, error: insertError } = await supabase
      .from('clients')
      .insert({ org_id: orgId, name: newName.trim(), created_by: userData?.user?.id })
      .select('id, name, company, website')
      .single()
    setCreating(false)
    if (insertError) {
      setError(friendlyError(insertError))
      return
    }
    setClients((prev) => [...prev, inserted].sort((a, b) => a.name.localeCompare(b.name)))
    setNewName('')
    setAdding(false)
    onSelect(inserted)
  }

  if (adding) {
    return (
      <div>
        <label htmlFor={`${id}-new`} className="block text-sm font-medium mb-1">{label}</label>
        <div className="flex gap-2">
          <input
            id={`${id}-new`}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New client name…"
            className="flex-1 min-w-0 rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
            autoFocus
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="text-sm rounded-md border px-3 py-2 flex-shrink-0 disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          >
            {creating ? 'Adding…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName(''); setError('') }}
            className="text-sm rounded-md border px-3 py-2 flex-shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs mt-1" style={{ color: 'var(--tally-alert)' }}>{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      <select
        id={id}
        value={value || ''}
        onChange={handleChange}
        disabled={loading}
        className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
        style={{ borderColor: 'var(--border)' }}
        required={required}
      >
        <option value="">{loading ? 'Loading clients…' : required ? 'Choose a client…' : 'No client'}</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="__add_new__">+ Add a new client…</option>
      </select>
      {error && <p className="text-xs mt-1" style={{ color: 'var(--tally-alert)' }}>{error}</p>}
    </div>
  )
}
