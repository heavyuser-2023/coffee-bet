import { useEffect, useRef, useState } from 'react';
import type { Player, TrajectoryFrame } from '../types';
import './RaceScreen.css';
import { Play, Pause, LogOut } from 'lucide-react';
import { PLAYER_COLORS } from '../constants';
import { RaceScreen } from './RaceScreen';

interface Props {
  players: Player[];
  videoUrl: string;
  // 영상 재생 불가 기기(예: WebM 미지원 iOS)에서의 궤적 폴백용
  amountsPool?: number[];
  raceResults?: string[];
  trajectory?: string; // JSON.stringify(TrajectoryFrame[])
  onExitReplay?: () => void;
}

/**
 * 💡 녹화된 레이스 영상을 그대로 재생하는 리플레이 화면.
 * 라이브 캔버스를 픽셀 단위로 녹화한 영상이라 100% 동일하게 재현된다.
 * 재생/일시정지·배속(1/2/4x)·타임라인 시킹·나가기 컨트롤을 제공한다.
 *
 * 만약 뷰어 기기가 해당 영상 코덱을 재생하지 못하면(video error),
 * 저장된 궤적 데이터로 자동 폴백하여 재생한다.
 */
export function ReplayScreen({
  players,
  videoUrl,
  amountsPool = [],
  raceResults = [],
  trajectory,
  onExitReplay,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState<1 | 2 | 4>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);

  // 영상 재생 실패 + 궤적 보유 시 → 궤적 기반 리플레이로 폴백
  let parsedTrajectory: TrajectoryFrame[] | null = null;
  if (videoFailed && trajectory) {
    try {
      parsedTrajectory = JSON.parse(trajectory);
    } catch {
      parsedTrajectory = null;
    }
  }
  if (videoFailed && parsedTrajectory) {
    return (
      <RaceScreen
        players={players}
        amountsPool={amountsPool}
        onFinish={() => {}}
        isReplay={true}
        replayTrajectory={parsedTrajectory}
        raceResults={raceResults}
        onExitReplay={onExitReplay}
      />
    );
  }

  // 배속 변경을 video 엘리먼트에 반영
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    // 일부 webm 녹화본은 duration이 Infinity로 보고됨 → 끝까지 seek해 실제 길이 확정
    if (!isFinite(video.duration)) {
      const fix = () => {
        video.currentTime = 0;
        setDuration(video.duration);
        video.removeEventListener('seeked', fix);
      };
      video.addEventListener('seeked', fix);
      video.currentTime = 1e7;
    } else {
      setDuration(video.duration);
    }
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended || video.currentTime >= video.duration) {
      video.currentTime = 0;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const seekTime = Number(e.target.value);
    video.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  return (
    <div className="race-container">
      <div className="race-header">
        <h2>📺 리플레이 재생</h2>
      </div>

      <div className="player-legend">
        {players.map((p, i) => (
          <div key={p.id} className="legend-item">
            <span className="dot" style={{ backgroundColor: PLAYER_COLORS[i % PLAYER_COLORS.length] }}></span>
            {p.name}
          </div>
        ))}
      </div>

      <div className="glass-panel canvas-container">
        <video
          ref={videoRef}
          src={videoUrl}
          className="replay-video"
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={() => {
            console.warn('영상 재생 실패 — 궤적 기반 리플레이로 폴백합니다.');
            setVideoFailed(true);
          }}
        />

        <div className="replay-controls">
          <div className="replay-timeline">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={currentTime}
              onChange={handleSeek}
              className="replay-slider"
            />
            <span className="replay-time-text">
              {currentTime.toFixed(1)}s / {(duration || 0).toFixed(1)}s
            </span>
          </div>

          <div className="replay-buttons">
            <div className="replay-btn-group">
              <button
                onClick={togglePlayback}
                className={`btn-icon ${isPlaying ? 'active' : ''}`}
                title={isPlaying ? '일시정지' : '재생'}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>

              <div className="playback-rate-selector">
                {([1, 2, 4] as const).map((rate) => (
                  <button
                    key={rate}
                    onClick={() => setPlaybackRate(rate)}
                    className={`rate-btn ${playbackRate === rate ? 'active' : ''}`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>

            {onExitReplay && (
              <button onClick={onExitReplay} className="btn-exit-replay">
                <LogOut size={16} style={{ marginRight: '6px', verticalAlign: 'middle', display: 'inline-block' }} />
                나가기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
