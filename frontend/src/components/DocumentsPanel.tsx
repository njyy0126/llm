import { type FormEvent, useCallback, useEffect, useState } from 'react'
import './DocumentsPanel.css'

type DocumentType = 'resume' | 'job_description' | 'other'

type IngestionResponse = {
  data: {
    fileId: string
    chunkCount: number
    preview: string[]
    file: {
      originalName: string
      mimeType: string
      sizeBytes: number
      totalChars: number
      documentType: DocumentType
      chunkSize: number
      overlap: number
    }
  }
}

type IndexStatus = {
  totalFiles: number
  indexedFiles: number
  partialFiles: number
  pendingFiles: number
  totalChunks: number
  indexedChunks: number
  pendingChunks: number
  qdrantCollection: string
  embeddingModel: string
}

type RetrievalResult = {
  score: number
  fileId: string
  fileName: string
  chunkId: string
  chunkIndex: number
  textPreview: string
}

const friendlyError = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export default function DocumentsPanel() {
  const [indexingMode, setIndexingMode] = useState<'auto' | 'manual'>('manual')
  const [apiStatus, setApiStatus] = useState<'loading' | 'online' | 'offline'>('loading')
  const [serverTime, setServerTime] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [documentType, setDocumentType] = useState<DocumentType>('resume')
  const [chunkSize, setChunkSize] = useState(800)
  const [overlap, setOverlap] = useState(120)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [result, setResult] = useState<IngestionResponse['data'] | null>(null)
  const [indexFileId, setIndexFileId] = useState('')
  const [vectorLoading, setVectorLoading] = useState(false)
  const [vectorMessage, setVectorMessage] = useState('')
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [statusRefreshLoading, setStatusRefreshLoading] = useState(false)
  const [statusRefreshError, setStatusRefreshError] = useState('')
  const [retrievalQuery, setRetrievalQuery] = useState('')
  const [retrievalTopK, setRetrievalTopK] = useState(5)
  const [retrievalFileId, setRetrievalFileId] = useState('')
  const [retrievalResults, setRetrievalResults] = useState<RetrievalResult[]>([])

  const fetchIndexStatus = useCallback(async () => {
    const response = await fetch('/api/vector/index/status')
    const payload = (await response.json()) as { message?: string; data?: IndexStatus }
    if (!response.ok || !payload.data) {
      throw new Error(payload.message || 'Failed to fetch indexing status')
    }
    setIndexStatus(payload.data)
  }, [])

  const checkService = useCallback(async () => {
    try {
      setApiStatus('loading')
      const response = await fetch('/api/health')
      if (!response.ok) throw new Error('Backend health endpoint returned non-200 response')
      const payload = (await response.json()) as { timestamp?: string }
      setApiStatus('online')
      setServerTime(payload.timestamp ?? '')
      await fetchIndexStatus()
    } catch {
      setApiStatus('offline')
      setServerTime('')
      setIndexStatus(null)
    }
  }, [fetchIndexStatus])

  useEffect(() => {
    const serviceCheckTimer = window.setTimeout(() => { void checkService() }, 0)
    return () => window.clearTimeout(serviceCheckTimer)
  }, [checkService])

  const handleRefreshIndexStatus = async () => {
    try {
      setStatusRefreshLoading(true)
      setStatusRefreshError('')
      setIndexStatus(null)
      await fetchIndexStatus()
    } catch (statusError) {
      setStatusRefreshError(friendlyError(statusError, 'Could not refresh index status.'))
    } finally {
      setStatusRefreshLoading(false)
    }
  }

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setUploadMessage('')
    setResult(null)
    if (!selectedFile) return setError('Choose a document before starting ingestion.')
    if (!Number.isFinite(chunkSize) || chunkSize < 100) return setError('Chunk size must be at least 100.')
    if (!Number.isFinite(overlap) || overlap < 0 || overlap >= chunkSize) {
      return setError('Overlap must be at least zero and smaller than chunk size.')
    }
    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('documentType', documentType)
    formData.append('chunkSize', String(chunkSize))
    formData.append('overlap', String(overlap))
    try {
      setLoading(true)
      const response = await fetch('/api/ingest', { method: 'POST', body: formData })
      const payload = (await response.json()) as IngestionResponse & { message?: string }
      if (!response.ok || !payload.data) throw new Error(payload.message || 'Ingestion failed')
      const uploadedData = payload.data
      setResult(uploadedData)
      setIndexFileId(uploadedData.fileId)
      setRetrievalFileId(uploadedData.fileId)
      if (indexingMode === 'auto') {
        const indexResponse = await fetch(`/api/vector/index/file/${uploadedData.fileId}`, { method: 'POST' })
        const indexPayload = (await indexResponse.json()) as { message?: string; data?: { newlyIndexed: number } }
        if (!indexResponse.ok) throw new Error(indexPayload.message || 'Auto indexing failed after upload')
        setUploadMessage(`Document uploaded and indexed. New chunks indexed: ${indexPayload.data?.newlyIndexed ?? 0}.`)
      } else {
        setUploadMessage('Document uploaded. Run manual indexing when you are ready to make it available.')
      }
      await fetchIndexStatus()
    } catch (uploadError) {
      setError(friendlyError(uploadError, 'Upload failed.'))
    } finally {
      setLoading(false)
    }
  }

  const indexFile = async (fileId: string, successPrefix: string) => {
    const response = await fetch(`/api/vector/index/file/${fileId}`, { method: 'POST' })
    const payload = (await response.json()) as { message?: string; data?: { newlyIndexed: number } }
    if (!response.ok) throw new Error(payload.message || 'File indexing failed')
    return `${successPrefix} New chunks indexed: ${payload.data?.newlyIndexed ?? 0}.`
  }

  const handleManualIndexUploadedFile = async () => {
    if (!indexFileId.trim()) return setUploadMessage('Upload a file first, then run manual indexing.')
    try {
      setVectorLoading(true)
      setVectorMessage('')
      setUploadMessage('')
      setUploadMessage(await indexFile(indexFileId.trim(), 'Manual indexing completed.'))
      await fetchIndexStatus()
    } catch (indexError) {
      setUploadMessage(friendlyError(indexError, 'Manual indexing failed.'))
    } finally {
      setVectorLoading(false)
    }
  }

  const handleDeleteUploadedFiles = async () => {
    if (!window.confirm('Delete all uploaded files, chunks, and vector index mappings? This cannot be undone.')) return
    try {
      setLoading(true)
      setError('')
      setUploadMessage('')
      const response = await fetch('/api/ingest/files', { method: 'DELETE' })
      const payload = (await response.json()) as { message?: string; data?: { deletedFiles: number; deletedChunks: number; deletedVectorIndexes: number } }
      if (!response.ok || !payload.data) throw new Error(payload.message || 'Failed to delete uploaded files')
      setSelectedFile(null)
      setResult(null)
      setIndexFileId('')
      setRetrievalFileId('')
      setRetrievalResults([])
      setUploadMessage(`Deleted ${payload.data.deletedFiles} files, ${payload.data.deletedChunks} chunks, and ${payload.data.deletedVectorIndexes} vector mappings.`)
      setVectorMessage('Upload data was cleared. Re-index files after new uploads.')
      await fetchIndexStatus()
    } catch (deleteError) {
      setError(friendlyError(deleteError, 'Failed to delete uploaded files.'))
    } finally {
      setLoading(false)
    }
  }

  const handleIndexAll = async () => {
    try {
      setVectorLoading(true)
      setVectorMessage('')
      const response = await fetch('/api/vector/index/all', { method: 'POST' })
      const payload = (await response.json()) as { message?: string; data?: { processedFiles: number } }
      if (!response.ok) throw new Error(payload.message || 'Index all failed')
      setVectorMessage(`Indexing run complete. Processed files: ${payload.data?.processedFiles ?? 0}.`)
      await fetchIndexStatus()
    } catch (vectorError) {
      setVectorMessage(friendlyError(vectorError, 'Index all failed.'))
    } finally {
      setVectorLoading(false)
    }
  }

  const handleIndexFile = async () => {
    if (!indexFileId.trim()) return setVectorMessage('Provide a file ID to index.')
    try {
      setVectorLoading(true)
      setVectorMessage('')
      setVectorMessage(await indexFile(indexFileId.trim(), 'File indexed.'))
      await fetchIndexStatus()
    } catch (vectorError) {
      setVectorMessage(friendlyError(vectorError, 'Index file failed.'))
    } finally {
      setVectorLoading(false)
    }
  }

  const handleClearVectorDb = async () => {
    if (!window.confirm('Delete all vectors from the vector database and reset indexing status? This cannot be undone.')) return
    try {
      setVectorLoading(true)
      setVectorMessage('')
      const response = await fetch('/api/vector/index/all', { method: 'DELETE' })
      const payload = (await response.json()) as { message?: string; data?: { clearedIndexRecords: number } }
      if (!response.ok || !payload.data) throw new Error(payload.message || 'Failed to clear vector indexes')
      setRetrievalResults([])
      setVectorMessage(`Cleared ${payload.data.clearedIndexRecords} vector index records.`)
      await fetchIndexStatus()
    } catch (vectorError) {
      setVectorMessage(friendlyError(vectorError, 'Clear vectors failed.'))
    } finally {
      setVectorLoading(false)
    }
  }

  const handleRetrieve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!retrievalQuery.trim()) return setVectorMessage('Enter a retrieval query.')
    try {
      setVectorLoading(true)
      setVectorMessage('')
      setRetrievalResults([])
      const response = await fetch('/api/vector/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: retrievalQuery.trim(), topK: retrievalTopK, fileId: retrievalFileId.trim() || undefined }),
      })
      const payload = (await response.json()) as { message?: string; data?: { results: RetrievalResult[] } }
      if (!response.ok || !payload.data) throw new Error(payload.message || 'Retrieval failed')
      setRetrievalResults(payload.data.results)
      setVectorMessage(`Retrieved ${payload.data.results.length} chunks.`)
    } catch (vectorError) {
      setVectorMessage(friendlyError(vectorError, 'Retrieval failed.'))
    } finally {
      setVectorLoading(false)
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="documents-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Knowledge base</p><h1 id="documents-heading">Documents</h1><p>Ingest source material, make it searchable, and check the evidence returned by retrieval.</p></div>
        <div className="service-check"><div className={`service-status ${apiStatus}`} role="status" aria-live="polite"><span aria-hidden="true" />{apiStatus === 'loading' ? 'Checking service' : apiStatus === 'online' ? 'Service online' : 'Service unavailable'}{serverTime && <small>{new Date(serverTime).toLocaleString()}</small>}</div>{apiStatus === 'offline' && <button type="button" className="service-retry" onClick={() => void checkService()}>Retry service check</button>}</div>
      </div>

      <div className="documents-layout">
        <section className="card upload-card" aria-labelledby="ingest-heading">
          <div className="card-heading"><div><p className="eyebrow">Step 1</p><h2 id="ingest-heading">Add a document</h2></div><span className="quiet-label">PDF, TXT, or DOCX</span></div>
          <form className="upload-form" onSubmit={handleUpload}>
            <div className="file-picker">
              <input id="document-file-input" className="visually-hidden-file-input" type="file" accept=".pdf,.txt,.docx" aria-describedby="document-file-selection" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
              <label className="file-picker-button" htmlFor="document-file-input">Choose file</label>
              <p id="document-file-selection" className="file-selection" aria-live="polite">{selectedFile ? <>Selected: <strong>{selectedFile.name}</strong></> : 'No file selected.'}</p>
            </div>
            <div className="form-grid">
              <label>Document type<select value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}><option value="resume">Resume</option><option value="job_description">Job description</option><option value="other">Other</option></select></label>
              <label>Indexing mode<select value={indexingMode} onChange={(event) => setIndexingMode(event.target.value as 'auto' | 'manual')}><option value="manual">Manual review</option><option value="auto">Index after upload</option></select></label>
              <label>Chunk size<input type="number" min={100} value={chunkSize} onChange={(event) => setChunkSize(Number(event.target.value))} /></label>
              <label>Overlap<input type="number" min={0} value={overlap} onChange={(event) => setOverlap(Number(event.target.value))} /></label>
            </div>
            <button type="submit" disabled={loading}>{loading ? 'Ingesting document…' : 'Ingest document'}</button>
          </form>
          <div className="inline-actions"><button type="button" className="secondary-button" onClick={handleManualIndexUploadedFile} disabled={loading || vectorLoading || indexingMode === 'auto' || !indexFileId.trim()}>{vectorLoading ? 'Indexing…' : 'Index uploaded file'}</button><button type="button" className="danger-button" onClick={handleDeleteUploadedFiles} disabled={loading}>Delete uploaded files</button></div>
          {error && <p className="notice error-text" role="alert">{error}</p>}
          {uploadMessage && <p className="notice success-text" role="status">{uploadMessage}</p>}
          {result && <div className="result"><h3>{result.file.originalName}</h3><dl className="facts"><div><dt>File ID</dt><dd>{result.fileId}</dd></div><div><dt>Chunks</dt><dd>{result.chunkCount}</dd></div><div><dt>Characters</dt><dd>{result.file.totalChars.toLocaleString()}</dd></div><div><dt>Configuration</dt><dd>{result.file.chunkSize} size / {result.file.overlap} overlap</dd></div></dl><details><summary>Text preview</summary><ul>{result.preview.map((item, index) => <li key={`${index}-${item.slice(0, 20)}`}>{item}</li>)}</ul></details></div>}
        </section>

        <aside className="card readiness-card" aria-labelledby="readiness-heading"><p className="eyebrow">Readiness</p><h2 id="readiness-heading">Index health</h2>{indexStatus ? <dl className="readiness-list"><div><dt>Files indexed</dt><dd>{indexStatus.indexedFiles} <span>of {indexStatus.totalFiles}</span></dd></div><div><dt>Chunks indexed</dt><dd>{indexStatus.indexedChunks} <span>of {indexStatus.totalChunks}</span></dd></div><div><dt>Needs attention</dt><dd>{indexStatus.partialFiles + indexStatus.pendingFiles}</dd></div><div><dt>Collection</dt><dd className="truncate" title={indexStatus.qdrantCollection}>{indexStatus.qdrantCollection}</dd></div></dl> : <p className="meta">{statusRefreshLoading ? 'Refreshing index status…' : 'Index status will appear once the service is available.'}</p>}{statusRefreshError && <p className="notice error-text" role="alert">{statusRefreshError}</p>}<button type="button" className="secondary-button" onClick={() => void handleRefreshIndexStatus()} disabled={statusRefreshLoading}>{statusRefreshLoading ? 'Refreshing status…' : 'Refresh status'}</button></aside>
      </div>

      <details className="advanced-tools"><summary>Advanced document operations</summary><div className="advanced-grid"><section className="card"><h2>Index management</h2><p className="meta">Run indexing for all pending files, or target one file ID.</p><div className="vector-actions"><button type="button" onClick={handleIndexAll} disabled={vectorLoading}>{vectorLoading ? 'Working…' : 'Index pending files'}</button><label>File ID<input value={indexFileId} onChange={(event) => setIndexFileId(event.target.value)} placeholder="Paste file ID" /></label><button type="button" className="secondary-button" onClick={handleIndexFile} disabled={vectorLoading}>Index this file</button><button type="button" className="danger-button" onClick={handleClearVectorDb} disabled={vectorLoading}>Delete all vectors</button></div></section><section className="card"><h2>Retrieval check</h2><form className="upload-form" onSubmit={handleRetrieve}><label>Query<input value={retrievalQuery} onChange={(event) => setRetrievalQuery(event.target.value)} placeholder="e.g. Node.js backend experience" /></label><div className="form-grid"><label>Top K<input type="number" min={1} max={20} value={retrievalTopK} onChange={(event) => setRetrievalTopK(Number(event.target.value))} /></label><label>Optional file ID<input value={retrievalFileId} onChange={(event) => setRetrievalFileId(event.target.value)} /></label></div><button type="submit" disabled={vectorLoading}>{vectorLoading ? 'Searching…' : 'Run retrieval check'}</button></form></section></div>{vectorMessage && <p className="notice" role="status" aria-live="polite">{vectorMessage}</p>}{retrievalResults.length > 0 && <section className="card retrieval-results" aria-labelledby="retrieval-results-heading"><h2 id="retrieval-results-heading">Retrieved evidence</h2><ol>{retrievalResults.map((item) => <li key={item.chunkId}><div><strong>{item.fileName}</strong><span>Chunk {item.chunkIndex} · score {item.score.toFixed(4)}</span></div><p>{item.textPreview}</p><small>{item.fileId} · {item.chunkId}</small></li>)}</ol></section>}</details>
    </section>
  )
}
