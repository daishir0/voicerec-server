'use client';

import { useState, useEffect, useCallback, useRef, DragEvent } from 'react';
import AudioPlayer from '@/components/AudioPlayer';

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

interface WhisperSegment {
  seq: number;
  startOffset: number;
  endOffset: number;
  startAt: string;
  endAt: string;
  text: string;
}

function formatOffset(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
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
  const [expandedPlayId, setExpandedPlayId] = useState<string | null>(null);
  const [expandedTextId, setExpandedTextId] = useState<string | null>(null);
  const [expandedSegmentsId, setExpandedSegmentsId] = useState<string | null>(null);
  const [segmentsCache, setSegmentsCache] = useState<Record<string, WhisperSegment[] | { error: string }>>({});

  const loadSegments = useCallback(async (id: string) => {
    if (segmentsCache[id]) return;
    const res = await fetch(`/admin/api/recordings/${id}/segments`);
    if (!res.ok) {
      setSegmentsCache((prev) => ({ ...prev, [id]: { error: `HTTP ${res.status}` } }));
      return;
    }
    const data = await res.json();
    setSegmentsCache((prev) => ({ ...prev, [id]: data.segments }));
  }, [segmentsCache]);

  const toggleSegments = useCallback((id: string) => {
    if (expandedSegmentsId === id) {
      setExpandedSegmentsId(null);
    } else {
      setExpandedSegmentsId(id);
      loadSegments(id);
    }
  }, [expandedSegmentsId, loadSegments]);

  // Upload state
  const [uploadUserId, setUploadUserId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchRecordings = useCallback(async () => {
    const params = filterUserId ? `?userId=${filterUserId}` : '';
    const res = await fetch(`/admin/api/recordings${params}`);
    if (res.ok) setRecordings(await res.json());
  }, [filterUserId]);

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
  useEffect(() => { fetchRecordings(); }, [fetchRecordings]);

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
    fetchRecordings();
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
    if (expandedPlayId === id) setExpandedPlayId(null);
    await fetch(`/admin/api/recordings/${id}`, { method: 'DELETE' });
    fetchRecordings();
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

      <div className="filter-row">
        <label>Filter by user:</label>
        <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </select>
      </div>
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
                    className={`btn btn-sm ${expandedPlayId === r.id ? 'btn-warning' : 'btn-primary'}`}
                    onClick={() => setExpandedPlayId(expandedPlayId === r.id ? null : r.id)}
                    title={expandedPlayId === r.id ? 'Close' : 'Play'}
                  >
                    {expandedPlayId === r.id ? '⏹' : '▶'}
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
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setExpandedTextId(expandedTextId === r.id ? null : r.id)}
                      >
                        {expandedTextId === r.id ? 'Hide' : 'GPT-4o'}
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{
                          background: r.whisperTranscribedAt ? '#5856d6' : '#999',
                          color: 'white',
                        }}
                        onClick={() => toggleSegments(r.id)}
                        title={r.whisperTranscribedAt ? 'Whisperセグメント表示' : 'Whisper未処理'}
                      >
                        {expandedSegmentsId === r.id ? 'Hide' : 'Whisper'}
                      </button>
                    </div>
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
              {expandedPlayId === r.id && (
                <tr key={r.id + '-player'}>
                  <td colSpan={10} style={{ padding: '8px 16px' }}>
                    <AudioPlayer src={`/admin/api/recordings/${r.id}`} />
                  </td>
                </tr>
              )}
              {expandedTextId === r.id && r.transcriptionText && (
                <tr key={r.id + '-text'}>
                  <td colSpan={10} style={{ background: '#f9f9f9', padding: '1rem', whiteSpace: 'pre-wrap', fontSize: '0.9em' }}>
                    {r.transcriptionText}
                  </td>
                </tr>
              )}
              {expandedSegmentsId === r.id && (
                <tr key={r.id + '-segments'}>
                  <td colSpan={10} style={{ background: '#f0f7ff', padding: '1rem', fontSize: '0.85em' }}>
                    {(() => {
                      const cached = segmentsCache[r.id];
                      if (!cached) return <div style={{ color: '#999' }}>Loading whisper segments...</div>;
                      if ('error' in cached) return <div style={{ color: '#ff3b30' }}>Error: {cached.error}</div>;
                      if (cached.length === 0) {
                        return (
                          <div style={{ color: '#999' }}>
                            {r.whisperTranscribedAt
                              ? 'No segments (empty audio?)'
                              : `Whisper未処理${r.whisperError ? ` (Error: ${r.whisperError})` : ''}`}
                          </div>
                        );
                      }
                      return (
                        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                          {cached.map((s) => (
                            <div key={s.seq} style={{ marginBottom: 4, fontFamily: 'monospace' }}>
                              <span style={{ color: '#5856d6', marginRight: 8 }}>
                                [{formatOffset(s.startOffset)}-{formatOffset(s.endOffset)}]
                              </span>
                              {s.text}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              )}
            </>
          ))}
          {recordings.length === 0 && (
            <tr><td colSpan={10} style={{ textAlign: 'center', color: '#999' }}>No recordings</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
