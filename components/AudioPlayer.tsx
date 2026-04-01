'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  src: string;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AudioPlayer({ src }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration || 0));
    audio.addEventListener('timeupdate', () => {
      if (!seekingRef.current) setCurrentTime(audio.currentTime);
    });
    audio.addEventListener('ended', () => { setPlaying(false); setCurrentTime(0); });
    audio.addEventListener('error', () => { setPlaying(false); });

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  }, [playing]);

  const handleSeekStart = () => {
    seekingRef.current = true;
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTime(parseFloat(e.target.value));
  };

  const handleSeekEnd = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = currentTime;
    }
    seekingRef.current = false;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="audio-player">
      <button className="audio-player-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
        {playing ? '⏸' : '▶'}
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
          className="audio-player-seek"
        />
      </div>
      <span className="audio-player-time">{fmt(duration)}</span>
    </div>
  );
}
