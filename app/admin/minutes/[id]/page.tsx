'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface RecordingDetail {
  id: string;
  displayName: string;
  filename: string;
  createdAt: string;
  duration: number;
  mimeType: string;
  transcriptionStatus: string;
  transcriptionText: string | null;
  transcriptionSegments: string | null;
  transcriptionError: string | null;
  transcriptionAt: string | null;
  language: string | null;
  user: { username: string };
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MinutesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [playing, setPlaying] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchRecording = useCallback(async () => {
    const res = await fetch('/admin/api/recordings');
    if (!res.ok) return;
    const all: RecordingDetail[] = await res.json();
    const found = all.find((r) => r.id === id);
    if (!found) return;
    setRecording(found);
    if (found.transcriptionSegments) {
      try {
        setSegments(JSON.parse(found.transcriptionSegments));
      } catch {
        setSegments([]);
      }
    }
  }, [id]);

  useEffect(() => { fetchRecording(); }, [fetchRecording]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handlePlay = () => {
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    const audio = new Audio(`/admin/api/recordings/${id}`);
    audio.onended = () => { setPlaying(false); audioRef.current = null; };
    audio.onerror = () => { setPlaying(false); audioRef.current = null; alert('再生エラー'); };
    audio.play();
    audioRef.current = audio;
    setPlaying(true);
  };

  const handleRetranscribe = async () => {
    if (!confirm('文字起こしを再実行しますか？')) return;
    setTranscribing(true);
    setRecording((prev) => prev ? { ...prev, transcriptionStatus: 'processing' } : prev);
    await fetch(`/admin/api/recordings/${id}/transcribe`, { method: 'POST' });
    await fetchRecording();
    setTranscribing(false);
  };

  if (!recording) {
    return <p>Loading...</p>;
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <button className="btn btn-sm" onClick={() => router.push('/admin/minutes')}>← 一覧に戻る</button>
        <h1 style={{ margin: 0 }}>{recording.displayName}</h1>
      </div>

      <div style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem' }}>
        <table style={{ borderCollapse: 'collapse', width: 'auto' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold', color: '#555' }}>ユーザー</td>
              <td style={{ padding: '4px 0' }}>{recording.user.username}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold', color: '#555' }}>録音日時</td>
              <td style={{ padding: '4px 0' }}>{new Date(recording.createdAt).toLocaleString()}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold', color: '#555' }}>長さ</td>
              <td style={{ padding: '4px 0' }}>{formatTime(recording.duration)}</td>
            </tr>
            {recording.transcriptionAt && (
              <tr>
                <td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold', color: '#555' }}>文字起こし日時</td>
                <td style={{ padding: '4px 0' }}>{new Date(recording.transcriptionAt).toLocaleString()}</td>
              </tr>
            )}
            {recording.language && (
              <tr>
                <td style={{ padding: '4px 12px 4px 0', fontWeight: 'bold', color: '#555' }}>言語</td>
                <td style={{ padding: '4px 0' }}>{recording.language}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button
          className={`btn ${playing ? 'btn-warning' : 'btn-primary'}`}
          onClick={handlePlay}
        >
          {playing ? '⏹ 停止' : '▶ 再生'}
        </button>
        <button
          className="btn btn-sm"
          onClick={handleRetranscribe}
          disabled={transcribing || recording.transcriptionStatus === 'processing'}
        >
          {transcribing ? '処理中...' : '🔄 文字起こし再実行'}
        </button>
      </div>

      {recording.transcriptionStatus === 'error' && (
        <div style={{ background: '#ffe5e5', border: '1px solid #c00', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem' }}>
          <strong>エラー:</strong> {recording.transcriptionError}
        </div>
      )}

      {recording.transcriptionStatus === 'processing' && (
        <div style={{ background: '#fff8e5', border: '1px solid #f90', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem' }}>
          文字起こし処理中...
        </div>
      )}

      {recording.transcriptionText && (
        <>
          <h2>全文テキスト</h2>
          <div style={{
            background: '#fff',
            border: '1px solid #ddd',
            padding: '1rem',
            borderRadius: '6px',
            marginBottom: '1.5rem',
            lineHeight: '1.8',
            whiteSpace: 'pre-wrap',
          }}>
            {recording.transcriptionText}
          </div>

          {segments.length > 0 && (
            <>
              <h2>タイムスタンプ付きセグメント</h2>
              <div style={{ border: '1px solid #ddd', borderRadius: '6px', overflow: 'hidden' }}>
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: '1rem',
                      padding: '0.5rem 1rem',
                      borderBottom: i < segments.length - 1 ? '1px solid #eee' : undefined,
                      background: i % 2 === 0 ? '#fafafa' : '#fff',
                    }}
                  >
                    <span style={{ color: '#007bff', minWidth: '80px', fontFamily: 'monospace', fontSize: '0.9em' }}>
                      {formatTime(seg.start)}
                    </span>
                    <span style={{ lineHeight: '1.6' }}>{seg.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {recording.transcriptionStatus === 'pending' && (
        <p style={{ color: '#999' }}>文字起こしがまだ実施されていません。一覧ページから文字起こしを開始してください。</p>
      )}
    </>
  );
}
