'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Recording {
  id: string;
  displayName: string;
  filename: string;
  createdAt: string;
  duration: number;
  transcriptionStatus: string;
  transcriptionText: string | null;
  user: { username: string };
}

const STATUS_LABEL: Record<string, string> = {
  pending: '未実施',
  processing: '処理中...',
  completed: '完了',
  error: 'エラー',
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#999',
  processing: '#f90',
  completed: '#090',
  error: '#c00',
};

export default function MinutesPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRecordings = useCallback(async () => {
    const res = await fetch('/admin/api/recordings');
    if (res.ok) setRecordings(await res.json());
  }, []);

  useEffect(() => { fetchRecordings(); }, [fetchRecordings]);

  const handleTranscribe = async (id: string) => {
    setRecordings((prev) =>
      prev.map((r) => r.id === id ? { ...r, transcriptionStatus: 'processing' } : r)
    );
    setLoading(true);
    await fetch(`/admin/api/recordings/${id}/transcribe`, { method: 'POST' });
    await fetchRecordings();
    setLoading(false);
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <h1>議事録</h1>
      <table>
        <thead>
          <tr>
            <th>録音名</th>
            <th>ユーザー</th>
            <th>録音日時</th>
            <th>長さ</th>
            <th>文字起こし状態</th>
            <th>文字数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => (
            <tr key={r.id}>
              <td>{r.displayName}</td>
              <td>{r.user.username}</td>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>{formatDuration(r.duration)}</td>
              <td>
                <span style={{ color: STATUS_COLOR[r.transcriptionStatus] ?? '#999', fontWeight: 'bold' }}>
                  {STATUS_LABEL[r.transcriptionStatus] ?? r.transcriptionStatus}
                </span>
              </td>
              <td>{r.transcriptionText ? r.transcriptionText.length + '文字' : '-'}</td>
              <td>
                {r.transcriptionStatus === 'completed' ? (
                  <Link href={`/admin/minutes/${r.id}`} className="btn btn-primary btn-sm">閲覧</Link>
                ) : r.transcriptionStatus === 'processing' ? (
                  <span style={{ color: '#f90' }}>処理中...</span>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => handleTranscribe(r.id)}
                    disabled={loading}
                  >
                    文字起こし開始
                  </button>
                )}
              </td>
            </tr>
          ))}
          {recordings.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#999' }}>録音がありません</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
