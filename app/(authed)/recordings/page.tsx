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
  createdAt: string;
  recordedAt: string | null;
  whisperTranscribedAt: string | null;
  whisperError: string | null;
  // admin only:
  userId?: string;
  user?: { username: string };
  deletedByUser?: boolean;
  deletedByUserAt?: string | null;
}

interface UserOption {
  id: string;
  username: string;
}

const ACCEPTED_EXTS = ['.mp3', '.mp4', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.mpeg', '.mpga', '.aac'];

/**
 * 統合録音一覧ページ。Cookie session の role に応じて UI を切替える：
 * - user: 自分の録音のみ。論理削除。
 * - admin: 全ユーザー横断。Filter by user、User 列、Visibility 列、targetUserId アップロード、物理削除。
 */
export default function RecordingsPage() {
  const [role, setRole] = useState<'user' | 'admin' | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
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

  // Admin-only state
  const [users, setUsers] = useState<UserOption[]>([]);
  const [filterUserId, setFilterUserId] = useState('');
  const [uploadUserId, setUploadUserId] = useState('');

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 自分の役割を取得
  useEffect(() => {
    fetch('/api/session/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { role: 'user' | 'admin' } | null) => {
        setRole(data?.role ?? 'user');
      });
  }, []);

  // admin の場合はユーザー一覧を取得
  useEffect(() => {
    if (role !== 'admin') return;
    fetch('/api/admin/users')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: UserOption[]) => {
        setUsers(data);
        if (data.length > 0 && !uploadUserId) {
          setUploadUserId(data[0].id);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  /** 録音一覧取得。reset=true で先頭から、false でカーソル続きを取得 */
  const fetchRecordings = useCallback(
    async (reset: boolean) => {
      if (!role) return;
      if (reset) setLoading(true); else setLoadingMore(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        if (appliedSearch) params.set('search', appliedSearch);
        if (role === 'admin' && filterUserId) params.set('userId', filterUserId);
        if (!reset && nextCursor) params.set('before', nextCursor);
        const res = await fetch(`/api/web/recordings?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as { items: Recording[]; nextCursor: string | null };
        setRecordings((prev) => (reset ? data.items : [...prev, ...data.items]));
        setNextCursor(data.nextCursor);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [role, appliedSearch, filterUserId, nextCursor]
  );

  // 検索クエリ変更を 300ms デバウンス
  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // フィルタ条件 / role 変更で先頭から取り直し
  useEffect(() => {
    if (!role) return;
    setNextCursor(null);
    setRecordings([]);
    fetchRecordings(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, appliedSearch, filterUserId]);

  const isValidAudioFile = (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return ACCEPTED_EXTS.includes(ext) || file.type.startsWith('audio/') || file.type === 'video/mp4';
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(isValidAudioFile);
    if (validFiles.length === 0) {
      alert('No valid audio files selected.\nSupported: ' + ACCEPTED_EXTS.join(', '));
      return;
    }

    if (role === 'admin' && !uploadUserId) {
      alert('Please select a user first');
      return;
    }

    setUploading(true);
    let uploaded = 0;

    for (const file of validFiles) {
      setUploadProgress(`Uploading ${uploaded + 1}/${validFiles.length}: ${file.name}`);
      const formData = new FormData();
      formData.append('file', file);
      if (role === 'admin' && uploadUserId) {
        formData.append('userId', uploadUserId);
      }

      try {
        const res = await fetch('/api/web/upload', { method: 'POST', body: formData });
        if (!res.ok) {
          const data = await res.json();
          alert(`Failed to upload ${file.name}: ${data.error}`);
        }
      } catch {
        alert(`Error uploading ${file.name}`);
      }
      uploaded++;
    }

    setUploading(false);
    setUploadProgress('');
    setShowUpload(false);
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

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    if (expandedId === id) setExpandedId(null);
    await fetch(`/api/web/recordings/${id}`, { method: 'DELETE' });
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    setSwipedId(null);
    setDeletingId(null);
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

  const isAdmin = role === 'admin';
  const colSpan = isAdmin ? 9 : 8;

  return (
    <>
      {/* Toolbar: search + upload toggle */}
      <div className="recordings-toolbar">
        <div className="recordings-search">
          <input
            type="text"
            placeholder="Search recordings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>&times;</button>
          )}
        </div>
        <button
          className="btn btn-primary btn-upload-toggle"
          onClick={() => setShowUpload(!showUpload)}
        >
          {showUpload ? 'Close' : 'Upload'}
        </button>
      </div>

      {/* Admin: User filter */}
      {isAdmin && (
        <div className="filter-row" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <label>Filter by user:</label>
          <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
        </div>
      )}

      {/* Search results count */}
      {appliedSearch && !loading && (
        <div style={{ fontSize: '0.85em', color: '#888', marginBottom: '12px' }}>
          検索: &quot;{appliedSearch}&quot; — {recordings.length} 件{nextCursor ? '+' : ''}
        </div>
      )}

      {/* Upload Area */}
      <div className={`upload-area-wrapper ${showUpload ? 'show' : ''}`}>
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
          {isAdmin && !uploading && (
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
          )}
        </div>
      </div>

      {/* Desktop: Table */}
      <table className="desktop-table">
        <thead>
          <tr>
            <th>Play</th>
            <th>Name</th>
            {isAdmin && <th>User</th>}
            <th>Size</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Transcription</th>
            <th>Created</th>
            <th></th>
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
                  {isAdmin && r.deletedByUser && (
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: 4,
                        padding: '1px 6px',
                        borderRadius: 8,
                        fontSize: '0.7em',
                        color: '#fff',
                        background: '#dc3545',
                      }}
                      title={r.deletedByUserAt ? `Deleted: ${new Date(r.deletedByUserAt).toLocaleString()}` : ''}
                    >
                      user deleted
                    </span>
                  )}
                </td>
                {isAdmin && <td>{r.user?.username ?? '-'}</td>}
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
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={deletingId === r.id}
                    onClick={() => { if (confirm('この録音を削除しますか？')) handleDelete(r.id); }}
                  >
                    {deletingId === r.id ? '...' : 'Delete'}
                  </button>
                </td>
              </tr>
              {expandedId === r.id && (
                <tr key={r.id + '-detail'}>
                  <td colSpan={colSpan} style={{ padding: '4px 16px 12px', background: '#f9fafb' }}>
                    <RecordingDetailPanel
                      recordingId={r.id}
                      audioSrc={`/api/web/recordings/${r.id}`}
                      downloadName={r.originalName || r.filename}
                      transcriptionText={r.transcriptionText}
                      segmentsUrl={r.whisperTranscribedAt ? `/api/web/recordings/${r.id}/segments` : null}
                      whisperUnavailableHint={r.whisperError ? `セグメント未処理 (Error: ${r.whisperError})` : 'セグメント未処理'}
                    />
                  </td>
                </tr>
              )}
            </>
          ))}
          {loading && (
            <tr><td colSpan={colSpan} style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Loading...</td></tr>
          )}
          {!loading && recordings.length === 0 && (
            <tr><td colSpan={colSpan} style={{ textAlign: 'center', color: '#999' }}>
              {appliedSearch ? 'No matching recordings' : 'No recordings'}
            </td></tr>
          )}
          {!loading && nextCursor && (
            <tr>
              <td colSpan={colSpan} style={{ textAlign: 'center', padding: '12px' }}>
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

      {/* Mobile: Card List */}
      <div className="mobile-cards">
        {loading && (
          <div style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>Loading...</div>
        )}
        {!loading && recordings.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
            {appliedSearch ? 'No matching recordings' : 'No recordings'}
          </div>
        )}
        {recordings.map((r) => (
          <div key={r.id} className="recording-card-wrapper">
            <div
              className={`recording-card ${swipedId === r.id ? 'swiped' : ''}`}
              onClick={() => { if (swipedId === r.id) setSwipedId(null); }}
            >
              <div className="recording-card-header">
                <button
                  className={`btn btn-sm ${expandedId === r.id ? 'btn-warning' : 'btn-primary'}`}
                  onClick={() => toggleExpanded(r.id)}
                  aria-expanded={expandedId === r.id}
                >
                  {expandedId === r.id ? '✕' : '▶'}
                </button>
                <div className="recording-card-title">
                  <div style={{ fontWeight: 600 }}>{r.displayName}</div>
                  <div style={{ fontSize: '0.8em', color: '#999' }}>
                    {r.filename}
                    {isAdmin && r.user && ` · ${r.user.username}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {statusBadge(r.transcriptionStatus)}
                  <button
                    className="card-delete-toggle"
                    onClick={(e) => { e.stopPropagation(); setSwipedId(swipedId === r.id ? null : r.id); }}
                    title="Delete"
                  >
                    ...
                  </button>
                </div>
              </div>

              <div className="recording-card-meta">
                <span>{formatSize(r.fileSize)}</span>
                <span>{formatDuration(r.duration)}</span>
                <span>{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>

              {expandedId === r.id && (
                <RecordingDetailPanel
                  recordingId={r.id}
                  audioSrc={`/api/web/recordings/${r.id}`}
                  downloadName={r.originalName || r.filename}
                  transcriptionText={r.transcriptionStatus === 'completed' ? r.transcriptionText : null}
                  segmentsUrl={r.whisperTranscribedAt ? `/api/web/recordings/${r.id}/segments` : null}
                  whisperUnavailableHint={
                    r.transcriptionStatus !== 'completed'
                      ? '文字起こし処理中または未完了'
                      : r.whisperError
                        ? `セグメント未処理 (Error: ${r.whisperError})`
                        : 'セグメント未処理'
                  }
                />
              )}
            </div>
            {swipedId === r.id && (
              <div className="card-delete-action">
                <button
                  className="card-delete-btn"
                  disabled={deletingId === r.id}
                  onClick={() => { if (confirm('この録音を削除しますか？')) handleDelete(r.id); }}
                >
                  {deletingId === r.id ? '...' : 'Delete'}
                </button>
              </div>
            )}
          </div>
        ))}
        {!loading && nextCursor && (
          <div style={{ textAlign: 'center', padding: '12px' }}>
            <button
              className="btn btn-sm"
              disabled={loadingMore}
              onClick={() => fetchRecordings(false)}
            >
              {loadingMore ? '読み込み中...' : 'もっと読み込む'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
