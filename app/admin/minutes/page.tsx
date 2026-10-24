'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { fmtDateTime, fmtOffset } from '@/lib/format-time';

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
    // 議事録ページは録音件数が多くないユースケースを想定し、上限を 200 に
    const res = await fetch('/api/web/recordings?limit=200');
    if (res.ok) {
      const data = (await res.json()) as { items: Recording[] };
      setRecordings(data.items);
    }
  }, []);

  useEffect(() => { fetchRecordings(); }, [fetchRecordings]);

  const handleTranscribe = async (id: string) => {
    setRecordings((prev) =>
      prev.map((r) => r.id === id ? { ...r, transcriptionStatus: 'processing' } : r)
    );
    setLoading(true);
    await fetch(`/api/web/recordings/${id}/transcribe`, { method: 'POST' });
    await fetchRecordings();
    setLoading(false);
  };

  // 1時間を超える録音が「83:45」になっていた。共通ヘルパーは時間も出す
  const formatDuration = fmtOffset;

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
              <td>{fmtDateTime(r.createdAt)}</td>
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
