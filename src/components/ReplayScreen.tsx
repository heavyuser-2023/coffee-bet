import { useEffect, useMemo, useRef, useState } from 'react';
import type { Player, TrajectoryFrame } from '../types';
import type { ToastTone } from './ui/Toast';
import './RaceScreen.css';
import { ArrowLeft, Share2 } from 'lucide-react';
import { RaceParticipantsStrip, RaceScreen, ReplayControlsBar } from './RaceScreen';

interface Props {
  players: Player[];
  videoUrl: string;
  replayId?: string;
  // 영상 재생 불가 기기(예: WebM 미지원 iOS)에서의 궤적 폴백용
  amountsPool?: number[];
  raceResults?: string[];
  trajectory?: string; // JSON.stringify(TrajectoryFrame[])
  onExitReplay?: () => void;
  onNotify?: (msg: string, tone?: ToastTone) => void;
}

/**
 * 💡 녹화된 레이스 영상을 그대로 재생하는 리플레이 화면.
 * 라이브 캔버스를 픽셀 단위로 녹화한 영상이라 100% 동일하게 재현된다.
 * 재생/일시정지·배속(1/2/4x)·타임라인 시킹·공유·나가기 컨트롤을 제공한다.
 *
 * 만약 뷰어 기기가 해당 영상 코덱을 재생하지 못하면(video error),
 * 저장된 궤적 데이터로 자동 폴백하여 재생한다.
 */
export function ReplayScreen({
  players,
  videoUrl,
  replayId,
  amountsPool = [],
  raceResults = [],
  trajectory,
  onExitReplay,
  onNotify,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState<1 | 2 | 4>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);

  // 배속 변경을 video 엘리먼트에 반영 (early return 위에서 항상 호출해 Hooks 순서 보장)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // 영상 재생 실패 + 궤적 보유 시 → 궤적 기반 리플레이로 폴백
  const parsedTrajectory = useMemo<TrajectoryFrame[] | null>(() => {
    if (!videoFailed || !trajectory) return null;
    try {
      const parsed = JSON.parse(trajectory);
      return Array.isArray(parsed) ? (parsed as TrajectoryFrame[]) : null;
    } catch {
      return null;
    }
  }, [videoFailed, trajectory]);

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
    if (video.ended || (video.duration > 0 && video.currentTime >= video.duration)) {
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

  const handleShare = async () => {
    if (!replayId) {
      onNotify?.('공유할 리플레이 링크를 찾을 수 없습니다.', 'error');
      return;
    }
    const shareUrl = `${window.location.origin}${window.location.pathname}?replay=${replayId}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Coffee Bet 마블 레이스 리플레이',
          text: '오늘의 커피 내기 마블 레이스 리플레이를 확인해보세요!',
          url: shareUrl,
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        // Web Share 미지원/실패 시 클립보드 복사로 폴백
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      onNotify?.('리플레이 링크를 클립보드에 복사했습니다.', 'success');
    } catch {
      onNotify?.('링크 복사에 실패했습니다. 주소창에서 직접 복사해주세요.', 'error');
    }
  };

  return (
    <div className="race-container">
      <header className="race-topbar">
        <div className="race-topbar-left">
          {onExitReplay ? (
            <button
              type="button"
              onClick={onExitReplay}
              className="race-topbar-btn"
              aria-label="뒤로 가기"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span>뒤로</span>
            </button>
          ) : (
            <div className="race-topbar-spacer" aria-hidden="true" />
          )}
        </div>

        <div className="race-status-badge is-replay">
          <span className="race-status-dot" aria-hidden="true" />
          <span>리플레이</span>
        </div>

        <div className="race-topbar-right">
          <button
            type="button"
            onClick={handleShare}
            className="race-topbar-btn"
            aria-label="리플레이 공유하기"
          >
            <Share2 size={15} aria-hidden="true" />
            <span>공유</span>
          </button>
        </div>
      </header>

      <RaceParticipantsStrip players={players} ariaLabel="참가자 목록" />

      <div className="canvas-container">
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

        <ReplayControlsBar
          currentTimeSec={currentTime}
          totalDurationSec={duration || 0}
          sliderMax={duration || 0}
          sliderValue={currentTime}
          sliderStep={0.01}
          isPlaying={isPlaying}
          playbackRate={playbackRate}
          onSeek={handleSeek}
          onTogglePlayback={togglePlayback}
          onChangeRate={setPlaybackRate}
          onExitReplay={onExitReplay}
        />
      </div>
    </div>
  );
}
