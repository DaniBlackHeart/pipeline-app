import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25MB — matches the bucket's own server-side limit

function humanizeBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Keeps storage paths predictable and free of characters that cause
// trouble in URLs — spaces, unicode, etc all become a dash.
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-')
}

// Matches the app's existing icon style (see NotificationBell.jsx) — plain
// hand-written SVGs, no icon library dependency.
function LinkIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function UploadIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

export default function AttachmentsList({ orgId, parentType, parentId }) {
  const [attachments, setAttachments] = useState([])
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('attachments')
      .select('id, label, url, kind, storage_path, file_size, mime_type, created_at')
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

  const handleAddLink = async (e) => {
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
      kind: 'link',
      label: normalizedUrl,
      url: normalizedUrl,
      created_by: userData?.user?.id,
    })
    setAdding(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setUrl('')
    load()
  }

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    setError('')
    if (file.size > MAX_FILE_BYTES) {
      setError(`That file is ${humanizeBytes(file.size)} — the limit here is 25 MB. For anything bigger (like video masters), use a link instead.`)
      return
    }

    setUploading(true)
    const storagePath = `${orgId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`

    const { error: uploadError } = await supabase.storage.from('attachments').upload(storagePath, file)
    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const { data: userData } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('attachments').insert({
      org_id: orgId,
      parent_type: parentType,
      parent_id: parentId,
      kind: 'file',
      label: file.name,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.type || null,
      created_by: userData?.user?.id,
    })
    setUploading(false)

    if (insertError) {
      setError(insertError.message)
      // Best-effort cleanup so a failed row insert doesn't leave an orphaned
      // file silently sitting in storage.
      await supabase.storage.from('attachments').remove([storagePath])
      return
    }
    load()
  }

  const handleOpenFile = async (attachment) => {
    setError('')
    const { data, error: signError } = await supabase.storage
      .from('attachments')
      .createSignedUrl(attachment.storage_path, 60)
    if (signError) {
      setError(signError.message)
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const handleDelete = async (attachment) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))
    if (attachment.kind === 'file' && attachment.storage_path) {
      // Best-effort: if this fails, a few KB sit unused in storage rather
      // than the user getting stuck unable to remove the attachment at all.
      await supabase.storage.from('attachments').remove([attachment.storage_path])
    }
    const { error: deleteError } = await supabase.from('attachments').delete().eq('id', attachment.id)
    if (deleteError) setError(deleteError.message)
  }

  return (
    <div>
      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading attachments…</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm mb-3" style={{ color: 'var(--ink-muted)' }}>No attachments yet.</p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {attachments.map((a, i) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>
                  File {i + 1}
                </span>
                <span className="flex-shrink-0" style={{ color: 'var(--ink-muted)' }}>-</span>
                {a.kind === 'file' ? (
                  <button
                    onClick={() => handleOpenFile(a)}
                    className="text-sm underline truncate min-w-0 text-left"
                  >
                    {a.label}
                    {a.file_size != null && (
                      <span className="ml-1.5 text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                        ({humanizeBytes(a.file_size)})
                      </span>
                    )}
                  </button>
                ) : (
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-sm underline truncate min-w-0">
                    {a.label}
                  </a>
                )}
              </span>
              <button
                onClick={() => handleDelete(a)}
                className="text-xs flex-shrink-0"
                style={{ color: 'var(--tally-alert)' }}
                aria-label={`Remove File ${i + 1}`}
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

      <div className="flex items-center gap-2">
        <form onSubmit={handleAddLink} className="relative flex-1 min-w-0">
          <label htmlFor={`attach-url-${parentId}`} className="sr-only">Paste a link and press enter to add it</label>
          <input
            id={`attach-url-${parentId}`}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a Drive, Frame.io, or other link…"
            className="w-full rounded-md border pl-3 pr-9 py-2 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
          <button
            type="submit"
            disabled={adding}
            aria-label="Add link"
            title="Add link"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 disabled:opacity-60"
            style={{ color: 'var(--ink-muted)' }}
          >
            <LinkIcon />
          </button>
        </form>

        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelected}
          className="hidden"
          aria-label="Upload a file"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Upload a file"
          title="Upload a file"
          className="flex-shrink-0 rounded-md border p-2.5 disabled:opacity-60"
          style={{ borderColor: 'var(--border)' }}
        >
          <UploadIcon />
        </button>
      </div>
      <p className="text-xs mt-1.5" style={{ color: 'var(--ink-muted)' }}>
        {uploading ? 'Uploading…' : '25 MB max — for bigger files (video masters, etc.), use a link instead.'}
      </p>
    </div>
  )
}
