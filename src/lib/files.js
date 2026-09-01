export const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25MB — matches the bucket's own server-side limit

export function humanizeBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Keeps storage paths predictable and free of characters that cause
// trouble in URLs — spaces, unicode, etc all become a dash.
export function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-')
}
