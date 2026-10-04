import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import type { Player, TrajectoryFrame } from '../types';
import './RaceScreen.css';
import { Play, Pause, LogOut } from 'lucide-react';
import { PLAYER_COLORS } from '../constants';
import {
  createRaceWorld,
  playerIdOf,
  FIXED_STEP_MS,
  POP_BUMPER_RADIUS,
  SENSOR_Y,
  TRACK_WIDTH,
  VIEW_HEIGHT,
  WORLD_HEIGHT,
} from '../game/raceWorld';

interface Props {
  players: Player[];
  amountsPool: number[];
  onFinish: (results: string[], trajectory?: TrajectoryFrame[], videoBlob?: Blob) => void;
  isReplay?: boolean;
  replayTrajectory?: TrajectoryFrame[];
  raceResults?: string[]; // 리플레이 시 순위 보장을 위해 필요
  onExitReplay?: () => void;
}

const DEFAULT_TRAJECTORY: TrajectoryFrame[] = [];
const DEFAULT_RESULTS: string[] = [];

// 궤적 캡처 간격(실시간 기준, ≈30fps). 핀 충돌 곡선을 충분히 표현하면서 payload 부담을 억제
const SAMPLE_MS = 33;

// 캔버스 비트맵에 직접 칠하는 불투명 배경색.
// 라이브 화면의 실제 배경(body --bg-color #0f111a 위에 glass-panel rgba(255,255,255,0.05))을
// 합성한 색과 동일하게 맞춰, 라이브와 녹화 영상의 배경/반투명 요소 색이 어긋나지 않게 한다.
const CANVAS_BG_COLOR = '#1b1d25';

// 팝 범퍼 외형: 구슬(색이 꽉 찬 원 + 흰 테두리)과 헷갈리지 않도록 어두운 몸체에 금색 링·중심점을 둔 과녁형
const BUMPER_BODY_COLOR = '#111827';
const BUMPER_RING_COLOR = '#fbbf24';
const BUMPER_FLASH_COLOR = '#fffbeb';
// 피격 연출(실시간 기준): 짧게 하얗게 번쩍인 뒤, 퍼져 나가며 사라지는 링
const BUMPER_FLASH_MS = 120;
const BUMPER_RING_MS = 380;

// 녹화 영상 품질(비트레이트 상한). 캔버스가 375x500로 작고 색이 단순해
// 1.5Mbps + 30fps 조합으로도 충분한 선명도를 유지하면서 파일 용량(서버 저장량)을 최소화
const VIDEO_BITS_PER_SECOND = 1_500_000;
// 캔버스 캡처 프레임레이트. 30fps로 낮춰 동일 비트레이트 대비 프레임당 화질을 확보하고 용량 절감
const CAPTURE_FPS = 30;

// 현재 브라우저가 지원하는 녹화 컨테이너/코덱을 우선순위대로 탐색.
// mp4(H.264)를 우선해 iOS Safari를 포함한 모든 기기에서 공유 영상이 재생되도록 한다.
// (mp4 녹화 미지원 환경은 webm으로 폴백 → 재생 측에서도 webm 미지원이면 궤적 폴백)
function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* 일부 환경에서 isTypeSupported 미구현 → 무시하고 다음 후보 */
    }
  }
  return '';
}

export function RaceScreen({ 
  players, 
  onFinish, 
  isReplay = false, 
  replayTrajectory = DEFAULT_TRAJECTORY, 
  raceResults = DEFAULT_RESULTS, 
  onExitReplay 
}: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const [finishedPlayers, setFinishedPlayers] = useState<string[]>([]);
  const finishedRef = useRef<string[]>([]);
  
  const loopTimeoutIdRef = useRef<number | null>(null);
  const finishTimeoutRef = useRef<number | null>(null);

  // 라이브 레이스 녹화용 레퍼런스 (캔버스 → MediaRecorder → Blob)
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const captureStreamRef = useRef<MediaStream | null>(null);

  // 리플레이 전용 상태 및 레퍼런스
  const [isPlaying, setIsPlaying] = useState(true);
  const [replayTimeState, setReplayTimeState] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1 | 2 | 4>(1);

  const isPlayingRef = useRef(true);
  const replayTimeRef = useRef(0);
  const playbackRateRef = useRef<1 | 2 | 4>(1);
  const trajectoryRef = useRef<TrajectoryFrame[]>([]);
  const lastCaptureTimeRef = useRef(0);
  // 실시간 경과 누적(ms). timeScale(슬로우모션)의 영향을 받지 않는 캡처 시간축
  const realElapsedRef = useRef(0);

  const totalDuration = replayTrajectory.length > 0 
    ? replayTrajectory[replayTrajectory.length - 1].t 
    : 0;

  // React state와 Ref 동기화
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (!sceneRef.current) return;

    const Render = Matter.Render,
          Events = Matter.Events;

    // 트랙·구슬·범퍼 등 물리 월드 구성과 스텝 로직은 raceWorld 모듈이 담당
    // (헤드리스 시뮬레이션 테스트와 동일한 코드)
    const world = createRaceWorld({
      playerIds: players.map((p) => p.id),
      colors: PLAYER_COLORS,
      isReplay,
      startPositions: isReplay && replayTrajectory.length > 0 ? replayTrajectory[0].positions : undefined,
    });
    const engine = world.engine;
    engineRef.current = engine;
    const { marbles, spinner, midSpinner, popBumpers } = world;

    const width = TRACK_WIDTH;
    const viewHeight = VIEW_HEIGHT;
    const worldHeight = WORLD_HEIGHT;
    
    // Create renderer — 고정 폭을 사용하여 모든 기기에서 동일한 레이아웃 보장
    const render = Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width,
        height: viewHeight,
        background: CANVAS_BG_COLOR,
        wireframes: false,
        hasBounds: true, // Enable bounds for camera panning
        pixelRatio: 1 // 고정 해상도를 위해 pixelRatio 1로 고정
      }
    });
    
    // CSS 스케일링: 내부 해상도는 375px이지만 화면 컨테이너 너비에 맞게 확대/축소
    render.canvas.style.width = '100%';
    render.canvas.style.height = 'auto';
    renderRef.current = render;

    // ------------------ 팝 범퍼 피격 연출 ------------------
    // 마지막 피격 시각(실시간 performance.now 기준). 슬로우모션과 무관하게 일정한 속도로 연출
    const bumperHitAt: number[] = popBumpers.map(() => -Infinity);

    const isFlashing = (i: number, now: number) => now - bumperHitAt[i] < BUMPER_FLASH_MS;

    // 매 프레임 렌더 직전: 범퍼 몸체(어두운 원 + 금색 링) 채색, 피격 직후에는 하얗게 번쩍임
    const paintBumpers = (now: number) => {
      popBumpers.forEach((b, i) => {
        const flash = isFlashing(i, now);
        b.render.fillStyle = flash ? BUMPER_FLASH_COLOR : BUMPER_BODY_COLOR;
        b.render.strokeStyle = flash ? '#ffffff' : BUMPER_RING_COLOR;
        b.render.lineWidth = 4;
      });
    };

    // 렌더 직후: 범퍼 중심점·후광 + 피격 시 퍼져 나가는 링 (월드 좌표계로 그림)
    const drawBumperEffects = (now: number) => {
      const ctx = render.context;
      ctx.save();
      // 카메라 변환 적용(고정 폭·pixelRatio 1이라 스케일 없이 bounds만큼 평행이동)
      ctx.setTransform(1, 0, 0, 1, -render.bounds.min.x, -render.bounds.min.y);
      popBumpers.forEach((b, i) => {
        const { x, y } = b.position;
        const flash = isFlashing(i, now);

        // 중심점: 범퍼 몸체 안쪽이라 구슬과 겹치지 않으므로 위에 그림
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = flash ? '#ffffff' : BUMPER_RING_COLOR;
        ctx.fill();

        // 후광: 지나가는 구슬을 가리지 않도록 이미 그려진 것들 '뒤'에 그림
        ctx.globalCompositeOperation = 'destination-over';
        ctx.beginPath();
        ctx.arc(x, y, POP_BUMPER_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = flash ? 'rgba(255, 251, 235, 0.6)' : 'rgba(251, 191, 36, 0.28)';
        ctx.lineWidth = 4;
        ctx.stroke();

        // 피격 링: 순간 효과라 맨 위에 그림
        const elapsed = now - bumperHitAt[i];
        if (elapsed >= 0 && elapsed < BUMPER_RING_MS) {
          const progress = elapsed / BUMPER_RING_MS;
          ctx.globalCompositeOperation = 'source-over';
          ctx.beginPath();
          ctx.arc(x, y, POP_BUMPER_RADIUS + 4 + progress * 20, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(253, 230, 138, ${(1 - progress).toFixed(3)})`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      });
      ctx.restore();
    };

    // ------------------ 캔버스 비트맵 배경 채우기 ------------------
    // Matter는 매 프레임 비트맵을 '투명'으로 지우고 배경은 CSS로만 입힌다(canvas.style.background).
    // 그래서 captureStream으로 캡처되는 비트맵은 투명 → 알파 미지원 mp4 녹화 시 검정으로 합성되어
    // 라이브(배경 비쳐 보임)와 색이 달라진다. afterRender에서 destination-over로 '바디 뒤'에 불투명
    // 배경을 직접 그려넣어, 라이브와 녹화의 배경 및 반투명(rgba) 요소 색을 완전히 일치시킨다.
    Events.on(render, 'afterRender', () => {
      drawBumperEffects(performance.now());
      const ctx = render.context;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // 카메라(bounds) 변환 무시, 전체 비트맵 기준으로 채움
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = CANVAS_BG_COLOR;
      ctx.fillRect(0, 0, render.canvas.width, render.canvas.height);
      ctx.restore();
    });

    // ------------------ 라이브 레이스 영상 녹화 시작 ------------------
    // 캔버스에 그려지는 모든 픽셀(카메라 패닝·슬로우모션·구슬 경로)을 그대로 녹화해
    // 재생 시 100% 동일하게 재현한다. 미지원 환경에서는 자동으로 궤적 폴백을 사용.
    recorderRef.current = null;
    recordedChunksRef.current = [];
    captureStreamRef.current = null;
    if (!isReplay) {
      const canvasEl = render.canvas as HTMLCanvasElement & {
        captureStream?: (fps?: number) => MediaStream;
      };
      if (typeof MediaRecorder !== 'undefined' && typeof canvasEl.captureStream === 'function') {
        try {
          const mimeType = pickRecorderMime();
          const stream = canvasEl.captureStream(CAPTURE_FPS);
          captureStreamRef.current = stream;
          const recorder = new MediaRecorder(
            stream,
            mimeType
              ? { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND }
              : { videoBitsPerSecond: VIDEO_BITS_PER_SECOND }
          );
          recorder.ondataavailable = (e: BlobEvent) => {
            if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
          };
          recorder.start();
          recorderRef.current = recorder;
        } catch (err) {
          console.warn('영상 녹화를 시작할 수 없어 궤적 기반 리플레이로 대체합니다.', err);
          recorderRef.current = null;
          captureStreamRef.current = null;
        }
      }
    }

    // 레이스 종료 처리: 녹화를 멈춰 Blob을 만든 뒤 결과/궤적/영상을 부모로 전달
    const finalizeRace = () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = () => {
          const chunks = recordedChunksRef.current;
          const blob =
            chunks.length > 0
              ? new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
              : undefined;
          captureStreamRef.current?.getTracks().forEach((t) => t.stop());
          onFinish(finishedRef.current, trajectoryRef.current, blob);
        };
        try {
          recorder.stop();
        } catch {
          captureStreamRef.current?.getTracks().forEach((t) => t.stop());
          onFinish(finishedRef.current, trajectoryRef.current);
        }
      } else {
        onFinish(finishedRef.current, trajectoryRef.current);
      }
    };

    // ------------------ 리플레이(궤적) 재생 1스텝 ------------------
    const stepReplay = () => {
      if (isPlayingRef.current) {
        // 캡처와 동일한 실시간 축(스텝당 16.66ms)으로 진행 → 캡처/재생 시간축 완전 정합
        const delta = FIXED_STEP_MS * playbackRateRef.current;
        replayTimeRef.current = Math.min(totalDuration, replayTimeRef.current + delta);
        setReplayTimeState(replayTimeRef.current);
      }

      const t = replayTimeRef.current;
      
      // 보간할 두 프레임 찾기
      let f1 = replayTrajectory[0];
      let f2 = replayTrajectory[0];
      for (let i = 0; i < replayTrajectory.length; i++) {
        if (replayTrajectory[i].t <= t) {
          f1 = replayTrajectory[i];
        }
        if (replayTrajectory[i].t > t) {
          f2 = replayTrajectory[i];
          break;
        }
      }
      const ratio = f1.t !== f2.t ? (t - f1.t) / (f2.t - f1.t) : 0;

      // 구슬들 위치 강제 세팅 (보간 적용)
      marbles.forEach(marble => {
        const playerId = playerIdOf(marble);
        const p1 = f1.positions[playerId];
        const p2 = f2.positions[playerId];
        
        if (p1 && p2 && f1.t !== f2.t) {
          const x = p1.x + (p2.x - p1.x) * ratio;
          const y = p1.y + (p2.y - p1.y) * ratio;
          Matter.Body.setPosition(marble, { x, y });
        } else if (p1) {
          Matter.Body.setPosition(marble, { x: p1.x, y: p1.y });
        }
      });

      // 스피너 회전: 기록된 각도가 있으면 그대로 사용(슬로우모션 반영),
      // 구버전 궤적은 라이브의 "스텝당 +0.02 / -0.025"로 추정 (t는 실시간 ms, 스텝수 = t/16.66)
      if (f1.spin && f2.spin) {
        Matter.Body.setAngle(spinner, f1.spin[0] + (f2.spin[0] - f1.spin[0]) * ratio);
        Matter.Body.setAngle(midSpinner, f1.spin[1] + (f2.spin[1] - f1.spin[1]) * ratio);
      } else {
        const steps = t / FIXED_STEP_MS;
        Matter.Body.setAngle(spinner, steps * 0.02);
        Matter.Body.setAngle(midSpinner, steps * -0.025);
      }

      // 실시간 순위 정보 계산 (센서Y를 지나갔는지 검사)
      const passedIds = players
        .map(p => {
          const pos = f1.positions[p.id];
          return { id: p.id, y: pos ? pos.y : 0 };
        })
        .filter(item => item.y >= SENSOR_Y)
        .sort((a, b) => raceResults.indexOf(a.id) - raceResults.indexOf(b.id))
        .map(item => item.id);

      // 내용이 실제로 바뀐 경우에만 setState (매 틱 새 배열로 인한 불필요한 리렌더 방지)
      if (passedIds.join(',') !== finishedRef.current.join(',')) {
        finishedRef.current = passedIds;
        setFinishedPlayers(passedIds);
      }

      // 끝에 도달했을 때 일시정지
      if (t >= totalDuration && isPlayingRef.current) {
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
    };

    // ------------------ 라이브 물리 1스텝 ------------------
    const stepLive = () => {
      const { newlyFinished, bumperHits } = world.stepLive();

      if (bumperHits.length > 0) {
        const now = performance.now();
        bumperHits.forEach((i) => { bumperHitAt[i] = now; });
      }

      if (newlyFinished.length > 0) {
        finishedRef.current = [...world.finished];
        setFinishedPlayers([...world.finished]);

        if (world.finished.length === players.length) {
          if (finishTimeoutRef.current) {
            clearTimeout(finishTimeoutRef.current);
          }
          finishTimeoutRef.current = window.setTimeout(() => {
            finalizeRace();
          }, 2000);
        }
      }

      // 실시간 경과 누적 (stepLive 1회 = 고정 16.66ms 실시간, timeScale 무관)
      // → 슬로우모션 구간은 같은 실시간 동안 물리가 0.2배로 진행되어 프레임이 더 촘촘히 쌓이고,
      //   재생이 이를 실시간 등속으로 통과하면 그 구간이 자연히 느리게 재현됨(역전 연출이 데이터에 내장됨)
      realElapsedRef.current += FIXED_STEP_MS;
      const realElapsed = realElapsedRef.current;

      // 궤적(Trajectory) 주기적 캡처 (실시간 SAMPLE_MS 간격)
      if (realElapsed - lastCaptureTimeRef.current >= SAMPLE_MS) {
        lastCaptureTimeRef.current = realElapsed;
        const positions: { [playerId: string]: { x: number; y: number } } = {};
        marbles.forEach(m => {
          positions[playerIdOf(m)] = {
            x: Math.round(m.position.x),
            y: Math.round(m.position.y)
          };
        });
        trajectoryRef.current.push({
          t: Math.round(realElapsed),
          positions,
          spin: [+spinner.angle.toFixed(3), +midSpinner.angle.toFixed(3)],
        });
      }
    };

    // 카메라 Panning (리플레이 모드와 일반 모드 공통 적용) — 선두 구슬을 화면 위쪽 70% 지점에 둔다
    const updateCamera = () => {
      let leaderY: number | null;
      if (isReplay) {
        leaderY = marbles.length > 0 ? Math.max(...marbles.map((m) => m.position.y)) : null;
      } else {
        leaderY = world.leaderY();
      }
      if (leaderY === null) return;

      const targetMinY = leaderY - (viewHeight * 0.7);
      const currentMinY = render.bounds.min.y;
      let newMinY = currentMinY + (targetMinY - currentMinY) * 0.1;
      newMinY = Math.max(0, Math.min(worldHeight - viewHeight, newMinY));

      render.bounds.min.x = 0;
      render.bounds.max.x = width;
      render.bounds.min.y = newMinY;
      render.bounds.max.y = newMinY + viewHeight;
    };

    const hasReplayData = isReplay && replayTrajectory.length > 0;

    let lastTime = performance.now();
    let accumulator = 0;
    const tick = (delta: number) => {
      accumulator += delta;
      
      // 폭주 방지 (브라우저 비활성화 후 복귀 시 물리 연산 폭발 방지)
      if (accumulator > 150) {
        accumulator = 150;
      }

      while (accumulator >= FIXED_STEP_MS) {
        if (hasReplayData) {
          stepReplay();
        } else if (!isReplay) {
          stepLive();
        }
        updateCamera();
        accumulator -= FIXED_STEP_MS;
      }
      paintBumpers(performance.now());
      Matter.Render.world(render);
    };

    const updateLoop = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      tick(delta);
      loopTimeoutIdRef.current = window.setTimeout(updateLoop, 16);
    };
    loopTimeoutIdRef.current = window.setTimeout(updateLoop, 16);

    return () => {
      if (loopTimeoutIdRef.current) {
        clearTimeout(loopTimeoutIdRef.current);
      }
      if (finishTimeoutRef.current) {
        clearTimeout(finishTimeoutRef.current);
      }
      // 레이스 도중 화면을 벗어나면 녹화도 정리(누수 방지)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.onstop = null;
        try {
          recorderRef.current.stop();
        } catch {
          /* 이미 종료된 경우 무시 */
        }
      }
      captureStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      captureStreamRef.current = null;
      Events.off(render, 'afterRender');
      world.dispose();
      if (render.canvas) {
        render.canvas.remove();
      }
    };
  }, [players, isReplay, replayTrajectory]);

  // 리플레이 타임라인 조절 핸들러
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTime = Number(e.target.value);
    replayTimeRef.current = seekTime;
    setReplayTimeState(seekTime);
  };

  const togglePlayback = () => {
    if (replayTimeRef.current >= totalDuration) {
      replayTimeRef.current = 0;
      setReplayTimeState(0);
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="race-container">
      <div className="race-header">
        <h2>{isReplay ? '📺 리플레이 재생' : '🔥 마블 레이스 🔥'}</h2>
        <div className="live-rank">
          {finishedPlayers.map((id, index) => {
            const p = players.find(p => p.id === id);
            const color = PLAYER_COLORS[players.findIndex(player => player.id === id) % PLAYER_COLORS.length];
            return (
              <div key={id} className="rank-badge fadeIn" style={{ borderLeft: `4px solid ${color}` }}>
                <span className="rank-num">{index + 1}위</span>
                <span className="rank-name">{p?.name}</span>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="player-legend">
        {players.map((p, i) => (
          <div key={p.id} className="legend-item">
            <span className="dot" style={{ backgroundColor: PLAYER_COLORS[i % PLAYER_COLORS.length] }}></span>
            {p.name}
          </div>
        ))}
      </div>

      <div className="glass-panel canvas-container" ref={sceneRef}>
        {/* 리플레이 조작 컨트롤 바 */}
        {isReplay && (
          <div className="replay-controls">
            <div className="replay-timeline">
              <input 
                type="range" 
                min={0} 
                max={totalDuration} 
                value={replayTimeState} 
                onChange={handleSeek}
                className="replay-slider"
              />
              <span className="replay-time-text">
                {(replayTimeState / 1000).toFixed(1)}s / {(totalDuration / 1000).toFixed(1)}s
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
        )}
      </div>
    </div>
  );
}

