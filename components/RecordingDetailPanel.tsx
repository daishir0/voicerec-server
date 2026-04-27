'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AudioPlayer, { AudioPlayerHandle } from './AudioPlayer';

export interface WhisperSegment {
  seq: number;
  startOffset: number;
  endOffset: number;
  startAt?: string;
  endAt?: string;
  text: string;
}

export interface RecordingDetailPanelProps {
  recordingId: string;
  /** 音声ストリーム URL (例: /user/api/recordings/abc) */
  audioSrc: string;
  /** GPT-4o / 派生の全文 */
  transcriptionText: string | null;
  /** セグメント取得用 API URL (例: /user/api/recordings/abc/segments)。null ならセグメントタブ無効 */
  segmentsUrl: string | null;
  /** whisper 未処理 / エラー時のメッセージ */
  whisperUnavailableHint?: string;
}

type Tab = 'segments' | 'text';

function fmtOffset(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** ソート済みセグメントから現在再生位置を含む index を二分探索 */
function findActiveIndex(segments: WhisperSegment[], t: number): number {
  if (segments.length === 0) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.startOffset) hi = mid - 1;
    else if (t >= s.endOffset) lo = mid + 1;
    else return mid;
  }
  // どのセグメントの範囲にも入らない場合、直近の手前セグメントを返す
  return Math.max(0, hi);
}

/** 検索クエリでテキストをハイライト */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!lower.includes(q)) return text;
  const parts: React.ReactNode[] = [];
  let i = 0;
  let next = lower.indexOf(q, i);
  let key = 0;
  while (next !== -1) {
    if (next > i) parts.push(<span key={key++}>{text.slice(i, next)}</span>);
    parts.push(
      <mark key={key++} className="seg-hit">
        {text.slice(next, next + query.length)}
      </mark>
    );
    i = next + query.length;
    next = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(<span key={key++}>{text.slice(i)}</span>);
  return parts;
}

export default function RecordingDetailPanel({
  recordingId,
  audioSrc,
  transcriptionText,
  segmentsUrl,
  whisperUnavailableHint,
}: RecordingDetailPanelProps) {
  const playerRef = useRef<AudioPlayerHandle | null>(null);
  const [tab, setTab] = useState<Tab>(segmentsUrl ? 'segments' : 'text');
  const [segments, setSegments] = useState<WhisperSegment[] | null>(null);
  const [segmentsError, setSegmentsError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [search, setSearch] = useState('');
  const segmentsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeSegmentRef = useRef<HTMLDivElement | null>(null);

  // セグメント遅延読み込み (タブ切替 / segmentsUrl 変化時)
  useEffect(() => {
    if (tab !== 'segments' || !segmentsUrl) return;
    if (segments !== null) return; // already loaded
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(segmentsUrl);
        if (!res.ok) {
          if (!cancelled) setSegmentsError(`HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (!cancelled) setSegments((data.segments ?? []) as WhisperSegment[]);
      } catch (e) {
        if (!cancelled) setSegmentsError(e instanceof Error ? e.message : 'fetch failed');
      }
    })();
    return () => { cancelled = true; };
  }, [tab, segmentsUrl, segments]);

  // 再生位置 → アクティブセグメント追従
  const handleTimeUpdate = useCallback((sec: number) => {
    if (!segments || segments.length === 0) return;
    const idx = findActiveIndex(segments, sec);
    setActiveIdx((prev) => (prev === idx ? prev : idx));
  }, [segments]);

  // アクティブセグメントを可視範囲にスクロール
  useEffect(() => {
    if (activeIdx < 0) return;
    const el = activeSegmentRef.current;
    if (!el) return;
    const container = segmentsContainerRef.current;
    if (!container) return;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (elTop < viewTop || elBottom > viewBottom) {
      container.scrollTo({ top: elTop - container.clientHeight / 3, behavior: 'smooth' });
    }
  }, [activeIdx]);

  const onSegmentClick = useCallback((s: WhisperSegment) => {
    playerRef.current?.seek(s.startOffset, true);
  }, []);

  // 検索フィルタ + ハイライト
  const visibleSegments = useMemo(() => {
    if (!segments) return null;
    if (!search) return segments;
    const q = search.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, search]);

  return (
    <div className="rec-detail-panel">
      <div className="rec-detail-player-wrap">
        <AudioPlayer
          ref={playerRef}
          src={audioSrc}
          recordingId={recordingId}
          onTimeUpdate={handleTimeUpdate}
        />
      </div>

      <div className="rec-detail-tabs">
        <button
          type="button"
          className={`rec-detail-tab ${tab === 'segments' ? 'active' : ''}`}
          onClick={() => setTab('segments')}
          disabled={!segmentsUrl}
          title={segmentsUrl ? 'セグメント表示' : 'セグメント未処理'}
        >
          セグメント
        </button>
        <button
          type="button"
          className={`rec-detail-tab ${tab === 'text' ? 'active' : ''}`}
          onClick={() => setTab('text')}
          disabled={!transcriptionText}
        >
          全文
        </button>
        <div className="rec-detail-tabs-spacer" />
        {tab === 'segments' && segmentsUrl && (
          <input
            className="rec-detail-search"
            placeholder="セグメント内検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="セグメント内検索"
          />
        )}
      </div>

      {tab === 'text' && (
        <div className="rec-detail-text">
          {transcriptionText ? transcriptionText : <span style={{ color: '#999' }}>本文なし</span>}
        </div>
      )}

      {tab === 'segments' && (
        <div className="rec-detail-segments" ref={segmentsContainerRef}>
          {!segmentsUrl && (
            <div className="rec-detail-empty">
              {whisperUnavailableHint ?? 'セグメントは利用できません'}
            </div>
          )}
          {segmentsUrl && segmentsError && (
            <div className="rec-detail-error">エラー: {segmentsError}</div>
          )}
          {segmentsUrl && !segmentsError && !segments && (
            <div className="rec-detail-empty">読み込み中...</div>
          )}
          {segmentsUrl && segments && visibleSegments && visibleSegments.length === 0 && (
            <div className="rec-detail-empty">
              {search ? '一致するセグメント無し' : 'セグメント無し'}
            </div>
          )}
          {segmentsUrl && segments && visibleSegments && visibleSegments.length > 0 && (
            <div role="list">
              {visibleSegments.map((s) => {
                const isActive = activeIdx >= 0 && segments[activeIdx]?.seq === s.seq;
                return (
                  <div
                    key={s.seq}
                    ref={isActive ? activeSegmentRef : undefined}
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? 'true' : undefined}
                    className={`rec-detail-segment ${isActive ? 'active' : ''}`}
                    onClick={() => onSegmentClick(s)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSegmentClick(s);
                      }
                    }}
                  >
                    <span className="rec-detail-segment-time">
                      {fmtOffset(s.startOffset)}
                    </span>
                    <span className="rec-detail-segment-text">
                      {highlightText(s.text, search)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
