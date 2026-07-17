import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export default function AttachmentsList({ orgId, parentType, parentId }) {
  const [attachments, setAttachments] = useState([])
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('attachments')
      .select('id, label, url, created_at')
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .order('created_at', { ascending: true })
    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }
    setAttachments(data || [])
    setLoading(false)
  }, [parentType, parentId])

  useEffect(() => { load() }, [load])

  const handleAdd = async (e) => {
    e.preventDefault()
    setError('')
    if (!url.trim()) {
      setError('Paste a link first.')
      return
    }
    let normalizedUrl = url.trim()
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`

    setAdding(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('attachments').insert({
      org_id: orgId,
      parent_type: parentType,
      parent_id: parentId,
      label: label.trim() || normalizedUrl,
      url: normalizedUrl,
      created_by: userData?.user?.id,
    })
    setAdding(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setLabel('')
    setUrl('')
    load()
  }

  const handleDelete = async (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
    const { error: deleteError } = await supabase.from('attachments').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
  }

  return (
    <div>
      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading links…</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm mb-3" style={{ color: 'var(--ink-muted)' }}>No links yet.</p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <a href={a.url} target="_blank" rel="noreferrer" className="text-sm underline truncate min-w-0">
                {a.label}
              </a>
              <button
                onClick={() => handleDelete(a.id)}
                className="text-xs flex-shrink-0"
                style={{ color: 'var(--tally-alert)' }}
                aria-label={`Remove link ${a.label}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ background: 'var(--tally-alert-soft)', color: 'var(--tally-alert)' }} role="alert">
          {error}
        </p>
      )}

      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
        <label htmlFor={`attach-label-${parentId}`} className="sr-only">Link label</label>
        <input
          id={`attach-label-${parentId}`}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="rounded-md border px-3 py-2 text-sm sm:w-40 flex-shrink-0"
          style={{ borderColor: 'var(--border)' }}
        />
        <label htmlFor={`attach-url-${parentId}`} className="sr-only">Link URL</label>
        <input
          id={`attach-url-${parentId}`}
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Drive, Frame.io, or other link…"
          className="rounded-md border px-3 py-2 text-sm flex-1 min-w-0"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          type="submit"
          disabled={adding}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 flex-shrink-0"
          style={{ background: 'var(--ink)', color: 'var(--panel)' }}
        >
          Add
        </button>
      </form>
    </div>
  )
}
