import { useEffect } from 'react'
import AttachmentsList from './AttachmentsList'

export default function TaskAttachmentsDialog({ orgId, task, onClose }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(20, 23, 26, 0.4)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-attachments-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-lg p-6" style={{ background: 'var(--panel)' }}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 id="task-attachments-title" className="font-display font-bold text-lg">Attachments</h2>
          <button onClick={onClose} className="text-sm" style={{ color: 'var(--ink-muted)' }} aria-label="Close">✕</button>
        </div>
        <p className="text-sm mb-4 truncate" style={{ color: 'var(--ink-muted)' }}>{task.title}</p>

        <AttachmentsList orgId={orgId} parentType="task" parentId={task.id} />
      </div>
    </div>
  )
}
