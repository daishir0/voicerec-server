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
  transcriptionText: string | null;
  createdAt: string;
}

const ACCEPTED_EXTS = ['.mp3', '.mp4', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.mpeg', '.mpga', '.aac'];

export default function UserRecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchRecordings = useCallback(async () => {
    const res = await fetch('/user/api/recordings');
    if (res.ok) setRecordings(await res.json());
  }, []);

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
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return ACCEPTED_EXTS.includes(ext) || file.type.startsWith('audio/') || file.type === 'video/mp4';
  };

  const uploadFiles = async (files: FileList | File[]) => {
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

      try {
        const res = await fetch('/user/api/upload', { method: 'POST', body: formData });
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

  const handlePlay = (id: string) => {
    if (playingId === id) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setPlayingId(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const audio = new Audio(`/user/api/recordings/${id}`);
    audio.onended = () => { setPlayingId(null); audioRef.current = null; };
    audio.onerror = () => { setPlayingId(null); audioRef.current = null; alert('Playback error'); };
    audio.play();
    audioRef.current = audio;
    setPlayingId(id);
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
      <h1>My Recordings</h1>

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
      </div>

      <table>
        <thead>
          <tr>
            <th>Play</th>
            <th>Name</th>
            <th>Filename</th>
            <th>Size</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Transcription</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => (
            <>
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
                <td>{formatSize(r.fileSize)}</td>
                <td>{formatDuration(r.duration)}</td>
                <td>{statusBadge(r.transcriptionStatus)}</td>
                <td>
                  {r.transcriptionStatus === 'completed' ? (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    >
                      {expandedId === r.id ? 'Hide' : 'Show'}
                    </button>
                  ) : (
                    <span style={{ color: '#999', fontSize: '0.85em' }}>-</span>
                  )}
                </td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
              {expandedId === r.id && r.transcriptionText && (
                <tr key={r.id + '-text'}>
                  <td colSpan={8} style={{ background: '#f9f9f9', padding: '1rem', whiteSpace: 'pre-wrap', fontSize: '0.9em' }}>
                    {r.transcriptionText}
                  </td>
                </tr>
              )}
            </>
          ))}
          {recordings.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign: 'center', color: '#999' }}>No recordings</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
