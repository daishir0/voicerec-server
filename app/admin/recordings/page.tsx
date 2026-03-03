'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Recording {
  id: string;
  displayName: string;
  filename: string;
  originalName: string;
  fileSize: number;
  duration: number;
  mimeType: string;
  createdAt: string;
  user: { username: string };
}

interface User {
  id: string;
  username: string;
}

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filterUserId, setFilterUserId] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchRecordings = useCallback(async () => {
    const params = filterUserId ? `?userId=${filterUserId}` : '';
    const res = await fetch(`/admin/api/recordings${params}`);
    if (res.ok) setRecordings(await res.json());
  }, [filterUserId]);

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/admin/api/users');
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchRecordings(); }, [fetchRecordings]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handlePlay = (id: string) => {
    // 同じ録音を再度押したら停止
    if (playingId === id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingId(null);
      return;
    }

    // 既存の再生を停止
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(`/admin/api/recordings/${id}`);
    audio.onended = () => {
      setPlayingId(null);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingId(null);
      audioRef.current = null;
      alert('再生エラー');
    };
    audio.play();
    audioRef.current = audio;
    setPlayingId(id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recording?')) return;
    // 再生中なら停止
    if (playingId === id && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingId(null);
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
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <h1>Recordings</h1>
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
            <th>Type</th>
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
              <td>{r.mimeType}</td>
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
