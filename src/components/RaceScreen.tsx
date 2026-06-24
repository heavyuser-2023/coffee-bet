import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import type { Player, TrajectoryFrame } from '../types';
import './RaceScreen.css';
import { Play, Pause, LogOut } from 'lucide-react';
import { PLAYER_COLORS } from '../constants';

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

// tick 루프의 고정 물리 스텝(실시간 기준). Engine.update 1회 = 16.66ms 실시간 (timeScale 무관)
const FIXED_STEP_MS = 16.66;
// 궤적 캡처 간격(실시간 기준, ≈30fps). 핀 충돌 곡선을 충분히 표현하면서 payload 부담을 억제
const SAMPLE_MS = 33;

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
  
  // 선두(1위) 구슬 라벨 추적 레이더
  const leaderRef = useRef<string | null>(null);
  const slowMoTimeoutRef = useRef<number | null>(null);
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
    if (isReplay) {
      setFinishedPlayers([]);
      finishedRef.current = [];
      replayTimeRef.current = 0;
      setReplayTimeState(0);
      setIsPlaying(true);
      isPlayingRef.current = true;
    }
  }, [isReplay, replayTrajectory]);

  useEffect(() => {
    if (!sceneRef.current) return;

    const Engine = Matter.Engine,
          Render = Matter.Render,
          Bodies = Matter.Bodies,
          Composite = Matter.Composite,
          Events = Matter.Events;

    // Create engine
    const engine = Engine.create();
    engineRef.current = engine;
    
    // Create renderer — 고정 폭을 사용하여 모든 기기에서 동일한 레이아웃 보장
    const FIXED_WIDTH = 375; // iPhone 기준 설계 폭 (고정)
    const width = FIXED_WIDTH;
    const viewHeight = 500;
    const worldHeight = 3500; // 긴 트랙!
    
    const render = Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width,
        height: viewHeight,
        background: 'transparent',
        wireframes: false,
        hasBounds: true, // Enable bounds for camera panning
        pixelRatio: 1 // 고정 해상도를 위해 pixelRatio 1로 고정
      }
    });
    
    // CSS 스케일링: 내부 해상도는 375px이지만 화면 컨테이너 너비에 맞게 확대/축소
    render.canvas.style.width = '100%';
    render.canvas.style.height = 'auto';
    renderRef.current = render;

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

    // Boundary walls
    const wallOptions = { 
      isStatic: true, 
      restitution: 0.8, 
      friction: 0,
      render: { fillStyle: 'rgba(255,255,255,0.1)' } 
    };
    const leftWall = Bodies.rectangle(0, worldHeight / 2, 40, worldHeight, wallOptions);
    const rightWall = Bodies.rectangle(width, worldHeight / 2, 40, worldHeight, wallOptions);
    
    // Top funnel
    const funnelLeft = Bodies.rectangle(width / 2 - 120, 40, 200, 20, { 
      isStatic: true, 
      angle: Math.PI / 5,
      render: { fillStyle: 'rgba(255,255,255,0.2)' }
    });
    const funnelRight = Bodies.rectangle(width / 2 + 120, 40, 200, 20, { 
      isStatic: true, 
      angle: -Math.PI / 5,
      render: { fillStyle: 'rgba(255,255,255,0.2)' }
    });

    // Bottleneck
    const bottleneckY = 1200;
    const gap = 38;

    const funnelLength = 300;
    const funnelAngle = Math.PI / 6;
    const funnelDx = (funnelLength / 2) * Math.cos(funnelAngle);
    const funnelDy = (funnelLength / 2) * Math.sin(funnelAngle);

    const funnelLeftCenterX = (width / 2 - gap / 2) - funnelDx;
    const funnelLeftCenterY = bottleneckY - funnelDy;

    const bottleNeckFunnelLeft = Bodies.rectangle(funnelLeftCenterX, funnelLeftCenterY, funnelLength, 20, { 
      isStatic: true, angle: funnelAngle, render: { fillStyle: 'rgba(236,72,153,0.3)' }
    });
    
    const funnelRightCenterX = (width / 2 + gap / 2) + funnelDx;
    const funnelRightCenterY = bottleneckY - funnelDy;

    const bottleNeckFunnelRight = Bodies.rectangle(funnelRightCenterX, funnelRightCenterY, funnelLength, 20, { 
      isStatic: true, angle: -funnelAngle, render: { fillStyle: 'rgba(236,72,153,0.3)' }
    });

    const channelLength = 300;
    const channelY = bottleneckY + channelLength / 2;

    const channelLeft = Bodies.rectangle(width / 2 - gap / 2 - 10, channelY, 20, channelLength, wallOptions);
    const channelRight = Bodies.rectangle(width / 2 + gap / 2 + 10, channelY, 20, channelLength, wallOptions);
    
    const bumperLeft = Bodies.circle(width / 2 - gap / 2 - 10, bottleneckY, 10, wallOptions);
    const bumperRight = Bodies.circle(width / 2 + gap / 2 + 10, bottleneckY, 10, wallOptions);

    const midSpinnerY = bottleneckY - 50;
    const midSpinner = Bodies.rectangle(width / 2, midSpinnerY, 100, 15, {
      isStatic: true,
      render: { fillStyle: '#3b82f6' }
    });

    Composite.add(engine.world, [
      leftWall, rightWall, 
      funnelLeft, funnelRight,
      bottleNeckFunnelLeft, bottleNeckFunnelRight,
      channelLeft, channelRight,
      bumperLeft, bumperRight,
      midSpinner
    ]);

    // Pegs (핀)
    const pegs = [];
    const spacingX = width / 6;
    const sideMargin = 55; 

    // Upper pegs
    for (let y = 120; y < bottleneckY - 100; y += 45) {
      const isEven = Math.floor(y / 45) % 2 === 0;
      const cols = isEven ? 5 : 6;
      const startX = isEven ? spacingX : spacingX / 2;
      for (let col = 0; col < cols; col++) {
        const x = startX + col * spacingX;
        if (x > sideMargin && x < width - sideMargin) {
          pegs.push(Bodies.circle(x, y, 6, {
            isStatic: true, restitution: 0.6, render: { fillStyle: '#8b5cf6' }
          }));
        }
      }
    }

    // Lower pegs
    const finalFunnelY = worldHeight - 350;
    for (let y = bottleneckY + 360; y < finalFunnelY - 80; y += 45) {
      const isEven = Math.floor(y / 45) % 2 === 0;
      const cols = isEven ? 5 : 6;
      const startX = isEven ? spacingX : spacingX / 2;
      for (let col = 0; col < cols; col++) {
        const x = startX + col * spacingX;
        if (x > sideMargin && x < width - sideMargin) {
          pegs.push(Bodies.circle(x, y, 6, {
            isStatic: true, restitution: 0.5, render: { fillStyle: '#10b981' }
          }));
        }
      }
    }
    
    // Zigzag Bumper
    const bumperRadius = 25;
    const bumperOffsetX = 10;
    const wallBumpers = [];
    
    for (let y = 160; y < bottleneckY - 100; y += 100) {
      wallBumpers.push(
        Bodies.polygon(bumperOffsetX, y, 3, bumperRadius, { isStatic: true, angle: Math.PI, restitution: 0.5, render: { fillStyle: 'rgba(236,72,153,0.4)' } }) 
      );
      wallBumpers.push(
        Bodies.polygon(width - bumperOffsetX, y + 50, 3, bumperRadius, { isStatic: true, angle: 0, restitution: 0.5, render: { fillStyle: 'rgba(236,72,153,0.4)' } }) 
      );
    }
    for (let y = bottleneckY + 400; y < finalFunnelY - 100; y += 100) {
      wallBumpers.push(
        Bodies.polygon(bumperOffsetX, y, 3, bumperRadius, { isStatic: true, angle: Math.PI, restitution: 0.5, render: { fillStyle: 'rgba(16,185,129,0.4)' } })
      );
      wallBumpers.push(
        Bodies.polygon(width - bumperOffsetX, y + 50, 3, bumperRadius, { isStatic: true, angle: 0, restitution: 0.5, render: { fillStyle: 'rgba(16,185,129,0.4)' } })
      );
    }
    
    Composite.add(engine.world, [...pegs, ...wallBumpers]);

    // Final Funnel
    const finalFunnelLeftCenterX = (width / 2 - gap / 2) - funnelDx;
    const finalFunnelLeftCenterY = finalFunnelY - funnelDy;
    const finalFunnelLeft = Bodies.rectangle(finalFunnelLeftCenterX, finalFunnelLeftCenterY, funnelLength, 20, { 
      isStatic: true, angle: funnelAngle, render: { fillStyle: 'rgba(16,185,129,0.3)' }
    });
    
    const finalFunnelRightCenterX = (width / 2 + gap / 2) + funnelDx;
    const finalFunnelRightCenterY = finalFunnelY - funnelDy;
    const finalFunnelRight = Bodies.rectangle(finalFunnelRightCenterX, finalFunnelRightCenterY, funnelLength, 20, { 
      isStatic: true, angle: -funnelAngle, render: { fillStyle: 'rgba(16,185,129,0.3)' }
    });

    const finalBumperLeft = Bodies.circle(width / 2 - gap / 2 - 10, finalFunnelY, 10, wallOptions);
    const finalBumperRight = Bodies.circle(width / 2 + gap / 2 + 10, finalFunnelY, 10, wallOptions);

    const finalChannelLength = 200;
    const finalChannelY = finalFunnelY + finalChannelLength / 2;
    const smoothWallOptions = { isStatic: true, friction: 0, render: { fillStyle: 'rgba(255,255,255,0.1)' } };

    const finalChannelLeft = Bodies.rectangle(width / 2 - gap / 2 - 10, finalChannelY, 20, finalChannelLength, smoothWallOptions);
    const finalChannelRight = Bodies.rectangle(width / 2 + gap / 2 + 10, finalChannelY, 20, finalChannelLength, smoothWallOptions);

    // Spinner
    const spinnerY = finalFunnelY - 50; 
    const spinner = Bodies.rectangle(width / 2, spinnerY, 130, 15, {
      isStatic: true,
      render: { fillStyle: '#f59e0b' }
    });

    Composite.add(engine.world, [
      finalFunnelLeft, finalFunnelRight, 
      finalBumperLeft, finalBumperRight, 
      finalChannelLeft, finalChannelRight,
      spinner
    ]);

    // Finish line Sensor
    const sensorY = finalChannelY + finalChannelLength / 2 - 30;
    const finishLine = Bodies.rectangle(width / 2, sensorY, gap * 1.5, 30, {
      isStatic: true,
      isSensor: true,
      render: { fillStyle: 'rgba(239, 68, 68, 0.4)' },
      label: 'FinishLine'
    });
    
    // Slots
    const slotWalls: Matter.Body[] = [];
    const slotCount = players.length;
    const slotWidth = width / slotCount;
    for (let i = 1; i < slotCount; i++) {
      const x = i * slotWidth;
      const y = worldHeight - 40;
      slotWalls.push(Bodies.rectangle(x, y, 10, 80, smoothWallOptions));
      slotWalls.push(Bodies.circle(x, y - 40, 8, smoothWallOptions));
    }
    const ground = Bodies.rectangle(width / 2, worldHeight + 20, width, 40, smoothWallOptions);
    Composite.add(engine.world, [finishLine, ...slotWalls, ground]);

    // 출발 시 구슬의 세로 배치 순서를 완전히 랜덤하게 섞음 (참가자 배열 순서와 무관하게 떨어지도록)
    // Fisher-Yates 셔플로 각 참가자에게 무작위 세로 슬롯을 배정
    const dropOrder = players.map((_, i) => i);
    for (let i = dropOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dropOrder[i], dropOrder[j]] = [dropOrder[j], dropOrder[i]];
    }

    // Marbles
    const marbles = players.map((p, index) => {
      // 일반 모드에서는 랜덤 분포 출발, 리플레이 시에는 첫 프레임 데이터 좌표로 우선 초기화
      let startX = width / 2 + (Math.random() * 20 - 10);
      let startY = -(dropOrder[index] * 25) - 20;

      if (isReplay && replayTrajectory.length > 0) {
        const startFrame = replayTrajectory[0];
        const pPos = startFrame.positions[p.id];
        if (pPos) {
          startX = pPos.x;
          startY = pPos.y;
        }
      }

      return Bodies.circle(startX, startY, 11, {
        isStatic: isReplay, // 리플레이 모드에서는 수동 업데이트를 위해 static으로 둠
        restitution: 0.85,
        friction: 0.0001,
        frictionStatic: 0,
        frictionAir: 0.02,
        density: 0.005,
        label: `player_${p.id}`,
        render: {
          fillStyle: PLAYER_COLORS[index % PLAYER_COLORS.length],
          strokeStyle: '#fff',
          lineWidth: 2
        }
      });
    });
    Composite.add(engine.world, marbles);

    // Camera Panning & Update Logic
    Events.on(engine, 'beforeUpdate', () => {
      let activeMarbles = marbles;

      if (isReplay && replayTrajectory.length > 0) {
        // ------------------ 리플레이 재생 처리 ------------------
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

        // 구슬들 위치 강제 세팅 (보간 적용)
        marbles.forEach(marble => {
          const playerId = marble.label.split('_')[1];
          const p1 = f1.positions[playerId];
          const p2 = f2.positions[playerId];
          
          if (p1 && p2 && f1.t !== f2.t) {
            const ratio = (t - f1.t) / (f2.t - f1.t);
            const x = p1.x + (p2.x - p1.x) * ratio;
            const y = p1.y + (p2.y - p1.y) * ratio;
            Matter.Body.setPosition(marble, { x, y });
          } else if (p1) {
            Matter.Body.setPosition(marble, { x: p1.x, y: p1.y });
          }
        });

        // 스피너 회전: 라이브의 "스텝당 +0.02 / -0.025"와 정합 (t는 실시간 ms, 스텝수 = t/16.66)
        const steps = t / FIXED_STEP_MS;
        Matter.Body.setAngle(spinner, steps * 0.02);
        Matter.Body.setAngle(midSpinner, steps * -0.025);

        // 실시간 순위 정보 계산 (센서Y를 지나갔는지 검사)
        const passedIds = players
          .map(p => {
            const pos = f1.positions[p.id];
            return { id: p.id, y: pos ? pos.y : 0 };
          })
          .filter(item => item.y >= sensorY)
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
      } else {
        // ------------------ 일반 물리 시뮬레이션 처리 ------------------
        Matter.Body.setAngle(spinner, spinner.angle + 0.02);
        Matter.Body.setAngle(midSpinner, midSpinner.angle - 0.025);

        activeMarbles = marbles.filter(m => !finishedRef.current.includes(m.label.split('_')[1]));

        // 마블 끼임(Stuck) 방지 로직: 1초(60프레임) 동안 공간상 위치 변화가 극히 작으면 핀에 걸린 것으로 진단하여 속도를 강제 부여
        activeMarbles.forEach(m => {
          const customBody = m as any;
          
          if (customBody.lastPosX !== undefined && customBody.lastPosY !== undefined) {
            const dx = m.position.x - customBody.lastPosX;
            const dy = m.position.y - customBody.lastPosY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            // 미세한 부르르 떨림 속도(진동)에도 무관하게, 실제 좌표가 거의 이동하지 않은 경우 Stuck 판단
            if (dist < 0.8) {
              customBody.stuckFrames = (customBody.stuckFrames || 0) + 1;
            } else {
              customBody.stuckFrames = 0;
            }
          } else {
            customBody.stuckFrames = 0;
          }
          
          // 위치 갱신
          customBody.lastPosX = m.position.x;
          customBody.lastPosY = m.position.y;

          if (customBody.stuckFrames > 45) {
            // 질량이 커서 applyForce 대신 setVelocity를 사용하여 강제 속도를 부여해 핀에서 탈출시킴
            const jumpX = (Math.random() - 0.5) * 4; // 좌우 튀기기
            const jumpY = -3; // 살짝 위로 튀기기
            Matter.Body.setVelocity(m, { x: jumpX, y: jumpY });
            customBody.stuckFrames = 0;
          }
        });

        // 실시간 경과 누적 (Engine.update 1회 = 고정 16.66ms 실시간, timeScale 무관)
        // → 슬로우모션 구간은 같은 실시간 동안 물리가 0.2배로 진행되어 프레임이 더 촘촘히 쌓이고,
        //   재생이 이를 실시간 등속으로 통과하면 그 구간이 자연히 느리게 재현됨(역전 연출이 데이터에 내장됨)
        realElapsedRef.current += FIXED_STEP_MS;
        const realElapsed = realElapsedRef.current;

        // 궤적(Trajectory) 주기적 캡처 (실시간 SAMPLE_MS 간격)
        if (realElapsed - lastCaptureTimeRef.current >= SAMPLE_MS) {
          lastCaptureTimeRef.current = realElapsed;
          const positions: { [playerId: string]: { x: number; y: number } } = {};
          marbles.forEach(m => {
            const playerId = m.label.split('_')[1];
            positions[playerId] = {
              x: Math.round(m.position.x),
              y: Math.round(m.position.y)
            };
          });
          trajectoryRef.current.push({
            t: Math.round(realElapsed),
            positions
          });
        }
      }
      
      // 카메라 Panning 로직 (리플레이 모드와 일반 모드 공통 적용)
      if (activeMarbles.length > 0) {
        let maxY = 0;
        let currentLeader: string | null = null;
        for (const m of activeMarbles) {
          if (m.position.y > maxY) {
            maxY = m.position.y;
            currentLeader = m.label;
          }
        }

        // 역전 슬로우모션 효과 (일반 게임 모드 전용)
        if (!isReplay && currentLeader && leaderRef.current && currentLeader !== leaderRef.current) {
          if (engine.timing) {
            engine.timing.timeScale = 0.2;
          }
          if (slowMoTimeoutRef.current) {
            clearTimeout(slowMoTimeoutRef.current);
          }
          slowMoTimeoutRef.current = setTimeout(() => {
            if (engine.timing) {
              engine.timing.timeScale = 1.0;
            }
          }, 1500);
        }
        
        leaderRef.current = currentLeader;
        
        let targetMinY = maxY - (viewHeight * 0.7);
        let currentMinY = render.bounds.min.y;
        let newMinY = currentMinY + (targetMinY - currentMinY) * 0.1;
        newMinY = Math.max(0, Math.min(worldHeight - viewHeight, newMinY));

        render.bounds.min.x = 0;
        render.bounds.max.x = width;
        render.bounds.min.y = newMinY;
        render.bounds.max.y = newMinY + viewHeight;
      }
    });

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

    // 충돌 처리 (일반 모드 전용)
    if (!isReplay) {
      Events.on(engine, 'collisionStart', (event) => {
        const pairs = event.pairs;
        for (const pair of pairs) {
          let marbleBody = null;
          if (pair.bodyA.label === 'FinishLine' && pair.bodyB.label?.startsWith('player_')) {
            marbleBody = pair.bodyB;
          } else if (pair.bodyB.label === 'FinishLine' && pair.bodyA.label?.startsWith('player_')) {
            marbleBody = pair.bodyA;
          }

          if (marbleBody) {
            const playerId = marbleBody.label.split('_')[1];
            if (!finishedRef.current.includes(playerId)) {
              finishedRef.current.push(playerId);
              setFinishedPlayers([...finishedRef.current]);

              if (finishedRef.current.length === players.length) {
                if (finishTimeoutRef.current) {
                  clearTimeout(finishTimeoutRef.current);
                }
                finishTimeoutRef.current = window.setTimeout(() => {
                  finalizeRace();
                }, 2000);
              }
            }
          }
        }
      });
    }

    let lastTime = performance.now();
    let accumulator = 0;
    const tick = (delta: number) => {
      const timeStep = 16.66;
      accumulator += delta;
      
      // 폭주 방지 (브라우저 비활성화 후 복귀 시 물리 연산 폭발 방지)
      if (accumulator > 150) {
        accumulator = 150;
      }

      while (accumulator >= timeStep) {
        Matter.Engine.update(engine, timeStep);
        accumulator -= timeStep;
      }
      Matter.Render.world(render);
    };

    let frameCount = 0;
    let lastLogTime = performance.now();

    const updateLoop = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      tick(delta);
      
      frameCount++;
      if (now - lastLogTime >= 1000) {
        // [PHYSICS LOOP] 디버깅용 로그 비활성화
        // const yCoords = marbles.map(m => `${m.label.split('_')[1]}:${m.position.y.toFixed(1)}`).join(', ');
        // console.log(`[PHYSICS LOOP] FPS: ${frameCount}, delta sum: ${(now - lastLogTime).toFixed(1)}ms. Marbles Y: [${yCoords}]`);
        frameCount = 0;
        lastLogTime = now;
      }
      
      loopTimeoutIdRef.current = window.setTimeout(updateLoop, 16);
    };
    loopTimeoutIdRef.current = window.setTimeout(updateLoop, 16);

    return () => {
      if (loopTimeoutIdRef.current) {
        clearTimeout(loopTimeoutIdRef.current);
      }
      if (slowMoTimeoutRef.current) {
        clearTimeout(slowMoTimeoutRef.current);
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
      if (engineRef.current) {
         Events.off(engineRef.current, 'beforeUpdate');
         if (!isReplay) {
           Events.off(engineRef.current, 'collisionStart');
         }
         Composite.clear(engineRef.current.world, false, true);
         Engine.clear(engineRef.current);
      }
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

