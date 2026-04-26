'use client';

import { useState, useEffect, useCallback, useRef, DragEvent } from 'react';
import RecordingDetailPanel from '@/components/RecordingDetailPanel';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

interface Recording {
  id: string;
  displayName: string;
  filename: string;
  originalName: string;
  fileSize: number;
  duration: number;
  mimeType: string;
  transcriptionStatus: string;
  transcriptionText: string | null;
  deletedByUser: boolean;
  deletedByUserAt: string | null;
  createdAt: string;
  recordedAt: string | null;
  whisperTranscribedAt: string | null;
  whisperError: string | null;
  user: { username: string };
}

interface User {
  id: string;
  username: string;
}

const ACCEPTED_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/mp3', 'audio/aac', 'video/mp4'];
const ACCEPTED_EXTS = ['.mp3', '.mp4', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.mpeg', '.mpga', '.aac'];

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filterUserId, setFilterUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // 統合パネル: 1度に1録音だけ展開
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Search (デバウンス)
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  // Upload state
  const [uploadUserId, setUploadUserId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** 録音一覧取得。reset=true で先頭から、false でカーソル続きを取得 */
  const fetchRecordings = useCallback(
    async (reset: boolean) => {
      if (reset) setLoading(true); else setLoadingMore(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        if (filterUserId) params.set('userId', filterUserId);
        if (appliedSearch) params.set('search', appliedSearch);
        if (!reset && nextCursor) params.set('before', nextCursor);
        const res = await fetch(`/admin/api/recordings?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as { items: Recording[]; nextCursor: string | null };
        setRecordings((prev) => (reset ? data.items : [...prev, ...data.items]));
        setNextCursor(data.nextCursor);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filterUserId, appliedSearch, nextCursor]
  );

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/admin/api/users');
    if (res.ok) {
      const data = await res.json();
      setUsers(data);
      if (data.length > 0 && !uploadUserId) {
        setUploadUserId(data[0].id);
      }
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // searchQuery → appliedSearch のデバウンス
  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // フィルタ条件 (filterUserId / appliedSearch) 変更で先頭から取り直し
  useEffect(() => {
    setNextCursor(null);
    setRecordings([]);
    fetchRecordings(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUserId, appliedSearch]);

  const isValidAudioFile = (file: File) => {
    if (ACCEPTED_TYPES.some(t => file.type.startsWith(t.split('/')[0]) || file.type === t)) return true;
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return ACCEPTED_EXTS.includes(ext);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!uploadUserId) {
      alert('Please select a user first');
      return;
    }

    const validFiles = Array.from(files).filter(isValidAudioFile);
    if (validFiles.length === 0) {
      alert('No valid audio files selected.\nSupported: ' + ACCEPTED_EXTS.join(', '));
      return;
    }

    setUploading(true);
    let uploaded = 0;

    for (const file of validFiles) {
      setUploadProgress(`Uploading ${uploaded + 1}/${validFiles.length}: ${file.name}`);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', uploadUserId);

      try {
        const res = await fetch('/admin/api/upload', { method: 'POST', body: formData });
        if (!res.ok) {
          const data = await res.json();
          alert(`Failed to upload ${file.name}: ${data.error}`);
        }
      } catch (err) {
        alert(`Error uploading ${file.name}`);
      }
      uploaded++;
    }

    setUploading(false);
    setUploadProgress('');
    setNextCursor(null);
    fetchRecordings(true);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setDragOver(false); };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recording?')) return;
    if (expandedId === id) setExpandedId(null);
    await fetch(`/admin/api/recordings/${id}`, { method: 'DELETE' });
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: '#28a745',
      processing: '#ffc107',
      pending: '#6c757d',
      error: '#dc3545',
    };
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '0.75em',
        color: '#fff',
        background: colors[status] || '#6c757d',
      }}>{status}</span>
    );
  };

  return (
    <>
      <h1>Recordings</h1>

      {/* Upload Area */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#007bff' : '#ccc'}`,
          borderRadius: '12px',
          padding: '2rem',
          textAlign: 'center',
          cursor: uploading ? 'wait' : 'pointer',
          background: dragOver ? '#f0f7ff' : '#fafafa',
          marginBottom: '1.5rem',
          transition: 'all 0.2s ease',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTS.join(',')}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
        {uploading ? (
          <div>
            <div style={{ fontSize: '1.1em', color: '#007bff', marginBottom: '0.5rem' }}>Uploading...</div>
            <div style={{ color: '#666' }}>{uploadProgress}</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: '2em', marginBottom: '0.5rem', color: '#999' }}>+</div>
            <div style={{ color: '#666', marginBottom: '0.5rem' }}>
              Drop audio files here or click to select
            </div>
            <div style={{ fontSize: '0.8em', color: '#999' }}>
              Supported: {ACCEPTED_EXTS.join(', ')}
            </div>
          </>
        )}
        <div style={{ marginTop: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
          <label style={{ marginRight: '0.5rem', fontSize: '0.9em' }}>Upload as user:</label>
          <select
            value={uploadUserId}
            onChange={(e) => setUploadUserId(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="filter-row" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>Filter by user:</label>
        <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="検索 (名前・本文・ユーザー名)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>
      {appliedSearch && !loading && (
        <div style={{ fontSize: '0.85em', color: '#888', marginBottom: '12px' }}>
          検索: &quot;{appliedSearch}&quot; — {recordings.length} 件{nextCursor ? '+' : ''}
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Play</th>
            <th>Name</th>
            <th>User</th>
            <th>Size</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Transcription</th>
            <th>Visibility</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => (
            <>
              <tr key={r.id}>
                <td>
                  <button
                    className={`btn btn-sm ${expandedId === r.id ? 'btn-warning' : 'btn-primary'}`}
                    onClick={() => toggleExpanded(r.id)}
                    title={expandedId === r.id ? '閉じる' : '開く'}
                    aria-expanded={expandedId === r.id}
                  >
                    {expandedId === r.id ? '✕' : '▶'}
                  </button>
                </td>
                <td>
                  <div>{r.displayName}</div>
                  <div style={{ fontSize: '0.8em', color: '#999' }}>{r.filename}</div>
                </td>
                <td>{r.user.username}</td>
                <td>{formatSize(r.fileSize)}</td>
                <td>{formatDuration(r.duration)}</td>
                <td>{statusBadge(r.transcriptionStatus)}</td>
                <td>
                  {r.transcriptionStatus === 'completed' && r.transcriptionText ? (
                    <span
                      title={r.whisperTranscribedAt ? 'セグメント生成済み' : (r.whisperError ?? 'セグメント未処理')}
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 12,
                        background: r.whisperTranscribedAt ? '#e7f1ff' : '#f0f0f0',
                        color: r.whisperTranscribedAt ? '#1c5dc4' : '#666',
                        fontSize: '0.75em',
                      }}
                    >
                      {r.whisperTranscribedAt ? '✓ セグメント' : '— 未処理'}
                    </span>
                  ) : (
                    <span style={{ color: '#999', fontSize: '0.85em' }}>-</span>
                  )}
                </td>
                <td>
                  {r.deletedByUser ? (
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '0.75em',
                      color: '#fff',
                      background: '#dc3545',
                    }} title={r.deletedByUserAt ? `Deleted: ${new Date(r.deletedByUserAt).toLocaleString()}` : ''}>
                      user deleted
                    </span>
                  ) : (
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '0.75em',
                      color: '#fff',
                      background: '#28a745',
                    }}>visible</span>
                  )}
                </td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Delete</button>
                </td>
              </tr>
              {expandedId === r.id && (
                <tr key={r.id + '-detail'}>
                  <td colSpan={10} style={{ padding: '4px 16px 12px', background: '#f9fafb' }}>
                    <RecordingDetailPanel
                      recordingId={r.id}
                      audioSrc={`/admin/api/recordings/${r.id}`}
                      downloadName={r.originalName || r.filename}
                      transcriptionText={r.transcriptionText}
                      segmentsUrl={r.whisperTranscribedAt ? `/admin/api/recordings/${r.id}/segments` : null}
                      whisperUnavailableHint={r.whisperError ? `セグメント未処理 (Error: ${r.whisperError})` : 'セグメント未処理'}
                    />
                  </td>
                </tr>
              )}
            </>
          ))}
          {loading && (
            <tr><td colSpan={10} style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Loading...</td></tr>
          )}
          {!loading && recordings.length === 0 && (
            <tr><td colSpan={10} style={{ textAlign: 'center', color: '#999' }}>
              {appliedSearch ? 'No matching recordings' : 'No recordings'}
            </td></tr>
          )}
          {!loading && nextCursor && (
            <tr>
              <td colSpan={10} style={{ textAlign: 'center', padding: '12px' }}>
                <button
                  className="btn btn-sm"
                  disabled={loadingMore}
                  onClick={() => fetchRecordings(false)}
                >
                  {loadingMore ? '読み込み中...' : 'もっと読み込む'}
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
