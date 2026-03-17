'use client';

import { useState, useEffect, useCallback, useRef, DragEvent } from 'react';

interface Recording {
  id: string;
  displayName: string;
  filename: string;
  originalName: string;
  fileSize: number;
  duration: number;
  mimeType: string;
  transcriptionStatus: string;
  createdAt: string;
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
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

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

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handlePlay = (id: string) => {
    if (playingId === id) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setPlayingId(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const audio = new Audio(`/admin/api/recordings/${id}`);
    audio.onended = () => { setPlayingId(null); audioRef.current = null; };
    audio.onerror = () => { setPlayingId(null); audioRef.current = null; alert('Playback error'); };
    audio.play();
    audioRef.current = audio;
    setPlayingId(id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recording?')) return;
    if (playingId === id && audioRef.current) {
      audioRef.current.pause(); audioRef.current = null; setPlayingId(null);
    }
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
            <th>Filename</th>
            <th>User</th>
            <th>Size</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => (
            <tr key={r.id}>
              <td>
                <button
                  className={`btn btn-sm ${playingId === r.id ? 'btn-warning' : 'btn-primary'}`}
                  onClick={() => handlePlay(r.id)}
                  title={playingId === r.id ? 'Stop' : 'Play'}
                >
                  {playingId === r.id ? '⏹' : '▶'}
                </button>
              </td>
              <td>{r.displayName}</td>
              <td style={{ fontSize: '0.85em', color: '#666' }}>{r.filename}</td>
              <td>{r.user.username}</td>
              <td>{formatSize(r.fileSize)}</td>
              <td>{formatDuration(r.duration)}</td>
              <td>{statusBadge(r.transcriptionStatus)}</td>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {recordings.length === 0 && (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: '#999' }}>No recordings</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
