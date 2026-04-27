'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

export interface AudioPlayerHandle {
  /** 指定秒へシーク。play=true なら自動再生開始 */
  seek: (sec: number, play?: boolean) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
}

export interface AudioPlayerProps {
  src: string;
  /** 録音ID。再生位置 / 速度を localStorage に保存するキー */
  recordingId?: string;
  /** 再生位置が変わるたびに通知 (timeupdate) */
  onTimeUpdate?: (sec: number) => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const SKIP_SECONDS = 10;

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { src, recordingId, onTimeUpdate },
  ref
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);

  const storageKeyTime = recordingId ? `vrec:audio:${recordingId}:t` : null;
  const storageKeySpeed = recordingId ? `vrec:audio:${recordingId}:speed` : null;

  // 初期化: 速度復元 (再生位置はメタデータロード後に復元)
  useEffect(() => {
    if (!storageKeySpeed) return;
    try {
      const saved = localStorage.getItem(storageKeySpeed);
      if (saved) {
        const v = parseFloat(saved);
        if (SPEED_OPTIONS.includes(v as (typeof SPEED_OPTIONS)[number])) {
          setSpeed(v);
        }
      }
    } catch {
      /* localStorage 不可環境を許容 */
    }
  }, [storageKeySpeed]);

  // audio 要素ライフサイクル
  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onLoadedMeta = () => {
      setDuration(audio.duration || 0);
      // 保存された再生位置があれば復元
      if (storageKeyTime) {
        try {
          const saved = localStorage.getItem(storageKeyTime);
          if (saved) {
            const t = parseFloat(saved);
            if (isFinite(t) && t > 0 && t < (audio.duration || 0) - 1) {
              audio.currentTime = t;
              setCurrentTime(t);
            }
          }
        } catch {
          /* noop */
        }
      }
    };
    const onTimeUpd = () => {
      if (!seekingRef.current) {
        setCurrentTime(audio.currentTime);
        onTimeUpdate?.(audio.currentTime);
        // 1秒間隔で localStorage 書き込み (頻繁すぎる書き込み回避)
        if (storageKeyTime && Math.floor(audio.currentTime) !== Math.floor(currentTime)) {
          try {
            localStorage.setItem(storageKeyTime, String(audio.currentTime));
          } catch {
            /* noop */
          }
        }
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
      if (storageKeyTime) {
        try {
          localStorage.removeItem(storageKeyTime);
        } catch {
          /* noop */
        }
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // ネットワーク・コーデック等の予期せぬエラーは可視化したいので残す
    const onErr = () => {
      console.error('[AudioPlayer] audio error', audio.error);
      setPlaying(false);
    };

    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('timeupdate', onTimeUpd);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onErr);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('timeupdate', onTimeUpd);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onErr);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
    // 意図的に onTimeUpdate / currentTime / storageKey* を依存に入れない（再マウント回避）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // 速度反映 + 保存
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    // ピッチ補正 (Safari, Chrome, Firefox)
    type PreservesPitchHTMLAudioElement = HTMLAudioElement & {
      preservesPitch?: boolean;
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    const a = audio as PreservesPitchHTMLAudioElement;
    a.preservesPitch = true;
    a.mozPreservesPitch = true;
    a.webkitPreservesPitch = true;

    if (storageKeySpeed) {
      try {
        localStorage.setItem(storageKeySpeed, String(speed));
      } catch {
        /* noop */
      }
    }
  }, [speed, storageKeySpeed]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min((audio.duration || 0), audio.currentTime + delta));
    setCurrentTime(audio.currentTime);
  }, []);

  // imperative handle: 親コンポーネント (RecordingDetailPanel) から制御するため
  useImperativeHandle(ref, (): AudioPlayerHandle => ({
    seek: (sec: number, play = false) => {
      const audio = audioRef.current;
      if (!audio) return;
      const safeSec = Math.max(0, sec);
      const apply = () => {
        const dur = audio.duration;
        // duration が有効な時だけ上限クランプ。NaN/0 (メタデータ未読込) の場合は安全な秒数をそのまま使用
        const target = (isFinite(dur) && dur > 0) ? Math.min(safeSec, dur) : safeSec;
        audio.currentTime = target;
        setCurrentTime(target);
        if (play) {
          audio.play().catch((err) => console.error('[AudioPlayer] play() rejected', err));
        }
      };
      // メタデータ読込前に呼ばれた場合 (audio.duration === NaN) は loadedmetadata を待つ
      if (audio.readyState >= 1 /* HAVE_METADATA */) {
        apply();
      } else {
        audio.addEventListener('loadedmetadata', apply, { once: true });
      }
    },
    play: () => { void audioRef.current?.play(); },
    pause: () => { audioRef.current?.pause(); },
    getCurrentTime: () => audioRef.current?.currentTime ?? 0,
  }));

  // キーボードショートカット (このプレイヤーがフォーカスを持つ時のみ)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // input/textarea にフォーカスがあるときは無視
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      skip(e.shiftKey ? -15 : -5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      skip(e.shiftKey ? 15 : 5);
    } else if (e.key === 'j') {
      e.preventDefault();
      skip(-SKIP_SECONDS);
    } else if (e.key === 'l') {
      e.preventDefault();
      skip(SKIP_SECONDS);
    }
  }, [togglePlay, skip]);

  const handleSeekStart = () => { seekingRef.current = true; };
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTime(parseFloat(e.target.value));
  };
  const handleSeekEnd = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = currentTime;
    }
    seekingRef.current = false;
  };

  // ホバー時のプレビュー時刻 (PCのみ意味あり)
  const handleSeekMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
    const rect = (e.currentTarget as HTMLInputElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(ratio * duration);
    setHoverX(e.clientX - rect.left);
  };
  const handleSeekMouseLeave = () => setHoverTime(null);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="audio-player audio-player-v2"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="音声プレイヤー"
    >
      <button
        className="audio-player-btn audio-player-btn-skip"
        onClick={() => skip(-SKIP_SECONDS)}
        title="10秒戻る (←)"
        aria-label="10秒戻る"
      >
        ⏪
      </button>
      <button
        className="audio-player-btn audio-player-btn-main"
        onClick={togglePlay}
        title={playing ? '一時停止 (Space)' : '再生 (Space)'}
        aria-label={playing ? '一時停止' : '再生'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button
        className="audio-player-btn audio-player-btn-skip"
        onClick={() => skip(SKIP_SECONDS)}
        title="10秒進む (→)"
        aria-label="10秒進む"
      >
        ⏩
      </button>
      <span className="audio-player-time">{fmt(currentTime)}</span>
      <div className="audio-player-seek-wrapper">
        <div className="audio-player-seek-track">
          <div className="audio-player-seek-fill" style={{ width: `${progress}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onMouseDown={handleSeekStart}
          onTouchStart={handleSeekStart}
          onChange={handleSeekChange}
          onMouseUp={handleSeekEnd}
          onTouchEnd={handleSeekEnd}
          onMouseMove={handleSeekMouseMove}
          onMouseLeave={handleSeekMouseLeave}
          className="audio-player-seek"
          aria-label="再生位置"
        />
        {hoverTime !== null && (
          <div
            className="audio-player-seek-tooltip"
            style={{ left: `${hoverX}px` }}
          >
            {fmt(hoverTime)}
          </div>
        )}
      </div>
      <span className="audio-player-time">{fmt(duration)}</span>
      <select
        className="audio-player-speed"
        value={speed}
        onChange={(e) => setSpeed(parseFloat(e.target.value))}
        title="再生速度"
        aria-label="再生速度"
      >
        {SPEED_OPTIONS.map((s) => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
    </div>
  );
});

export default AudioPlayer;
