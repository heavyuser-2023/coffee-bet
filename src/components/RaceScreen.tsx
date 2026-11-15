import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import type { GameMode, Player, TrajectoryFrame } from '../types';
import './RaceScreen.css';
import { Play, Pause, LogOut, Volume2, VolumeX } from 'lucide-react';
import { PLAYER_COLORS } from '../constants';
import {
  createRaceWorld,
  playerIdOf,
  BOOST_PAD_POSITIONS,
  BOOST_PAD_RADIUS,
  FIXED_STEP_MS,
  GATEKEEPER_AMPLITUDE,
  GATEKEEPER_RADIUS,
  GATEKEEPER_Y,
  JUMP_PAD_POSITIONS,
  JUMP_PAD_RADIUS,
  POP_BUMPER_RADIUS,
  SENSOR_Y,
  TRACK_WIDTH,
  VIEW_HEIGHT,
  WORLD_HEIGHT,
} from '../game/raceWorld';
import { SoundController } from '../game/soundEffects';

interface Props {
  players: Player[];
  amountsPool: number[];
  gameMode?: GameMode;
  onFinish: (results: string[], trajectory?: TrajectoryFrame[], videoBlob?: Blob) => void;
  isReplay?: boolean;
  replayTrajectory?: TrajectoryFrame[];
  raceResults?: string[]; // 리플레이 시 순위 보장을 위해 필요
  onExitReplay?: () => void;
}

type CommentaryTone = 'overtake' | 'boost' | 'jump' | 'bumper' | 'finish' | 'climax';

interface CommentaryItem {
  id: number;
  text: string;
  tone: CommentaryTone;
  expiresAt: number;
}

interface ClimaxInfo {
  active: boolean;
  contenders: string[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
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
const GIMMICK_RING_MS = 400;

// 모션 트레일 및 중계 연출 상수
const MAX_TRAIL_LENGTH = 12;
const HOT_TRAIL_DURATION_MS = 500;
const COMMENTARY_DURATION_MS = 2200;

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

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function spawnParticles(
  particles: Particle[],
  x: number,
  y: number,
  colors: string[],
  count: number,
  minSpeed: number,
  maxSpeed: number,
  biasY = 0
) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
    const maxLife = 280 + Math.random() * 240;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed + biasY,
      radius: 2 + Math.random() * 2.5,
      color: colors[i % colors.length],
      life: maxLife,
      maxLife,
    });
  }
}

function drawBoostPads(ctx: CanvasRenderingContext2D, now: number, boostHitAt: number[]) {
  const phase = (now * 0.004) % 1;
  BOOST_PAD_POSITIONS.forEach((p, i) => {
    const elapsed = now - boostHitAt[i];
    const active = elapsed >= 0 && elapsed < 220;

    // 패드 베이스 및 흐르는 아래쪽 셰브론(>>>) — 구슬 뒤에 그린다
    ctx.globalCompositeOperation = 'destination-over';
    ctx.beginPath();
    ctx.arc(p.x, p.y, BOOST_PAD_RADIUS + 4, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(34, 211, 238, 0.25)' : 'rgba(6, 182, 212, 0.1)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, BOOST_PAD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 51, 68, 0.85)';
    ctx.fill();
    ctx.strokeStyle = active ? '#a5f3fc' : '#06b6d4';
    ctx.lineWidth = active ? 3 : 2;
    ctx.stroke();

    // 3단 셰브론 화살표 (아래 방향 가속 표시)
    for (let k = 0; k < 3; k++) {
      const wave = (phase + k / 3) % 1;
      const offsetY = p.y - 8 + k * 7;
      const alpha = active ? 1 : 0.35 + 0.65 * Math.sin(wave * Math.PI);
      ctx.beginPath();
      ctx.moveTo(p.x - 7, offsetY - 3);
      ctx.lineTo(p.x, offsetY + 3);
      ctx.lineTo(p.x + 7, offsetY - 3);
      ctx.strokeStyle = `rgba(103, 232, 249, ${alpha.toFixed(2)})`;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 발동 순간 확산 충격파 링 (구슬 위 레이어)
    if (elapsed >= 0 && elapsed < GIMMICK_RING_MS) {
      const progress = elapsed / GIMMICK_RING_MS;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(p.x, p.y, BOOST_PAD_RADIUS + progress * 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34, 211, 238, ${(1 - progress).toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  });
}

function drawJumpPads(ctx: CanvasRenderingContext2D, now: number, jumpHitAt: number[]) {
  const idleBounce = Math.sin(now * 0.008) * 1.5;
  JUMP_PAD_POSITIONS.forEach((p, i) => {
    const elapsed = now - jumpHitAt[i];
    const active = elapsed >= 0 && elapsed < 260;
    const bounceY = active ? -Math.sin((elapsed / 260) * Math.PI) * 5 : idleBounce;

    // 스프링 코일 이중 링 — 구슬 뒤 레이어
    ctx.globalCompositeOperation = 'destination-over';
    ctx.beginPath();
    ctx.arc(p.x, p.y, JUMP_PAD_RADIUS + 4, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(244, 63, 94, 0.28)' : 'rgba(244, 63, 94, 0.1)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, JUMP_PAD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(76, 5, 25, 0.85)';
    ctx.fill();
    ctx.strokeStyle = active ? '#fda4af' : '#f43f5e';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x, p.y, JUMP_PAD_RADIUS - 5, 0, Math.PI * 2);
    ctx.strokeStyle = active ? '#fed7aa' : '#fb923c';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 위쪽 삼각 화살표 (상승 반발 표시)
    const ay = p.y + bounceY;
    ctx.beginPath();
    ctx.moveTo(p.x, ay - 7);
    ctx.lineTo(p.x - 6, ay + 4);
    ctx.lineTo(p.x + 6, ay + 4);
    ctx.closePath();
    ctx.fillStyle = active ? '#ffffff' : '#fb923c';
    ctx.fill();

    // 발동 시 이중 충격파 링
    if (elapsed >= 0 && elapsed < GIMMICK_RING_MS) {
      const progress = elapsed / GIMMICK_RING_MS;
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.arc(p.x, p.y, JUMP_PAD_RADIUS + progress * 24, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(244, 63, 94, ${(1 - progress).toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  });
}

function drawGatekeeperEffects(
  ctx: CanvasRenderingContext2D,
  gatekeeper: Matter.Body,
  now: number,
  gatekeeperHitAt: number
) {
  const minX = TRACK_WIDTH / 2 - GATEKEEPER_AMPLITUDE;
  const maxX = TRACK_WIDTH / 2 + GATEKEEPER_AMPLITUDE;

  // 왕복 레일 가이드라인 (구슬 뒤 레이어)
  ctx.globalCompositeOperation = 'destination-over';
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(minX, GATEKEEPER_Y);
  ctx.lineTo(maxX, GATEKEEPER_Y);
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  [minX, maxX].forEach((endX) => {
    ctx.beginPath();
    ctx.arc(endX, GATEKEEPER_Y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(250, 204, 21, 0.5)';
    ctx.fill();
  });

  // 회전 코어 (본체 위)
  const { x, y } = gatekeeper.position;
  const elapsed = now - gatekeeperHitAt;
  const flash = elapsed >= 0 && elapsed < BUMPER_FLASH_MS;
  const rot = now * 0.005;

  ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(6, 0);
  ctx.lineTo(0, 6);
  ctx.lineTo(-6, 0);
  ctx.closePath();
  ctx.fillStyle = flash ? '#ffffff' : '#a855f7';
  ctx.fill();
  ctx.restore();

  if (elapsed >= 0 && elapsed < BUMPER_RING_MS) {
    const progress = elapsed / BUMPER_RING_MS;
    ctx.beginPath();
    ctx.arc(x, y, GATEKEEPER_RADIUS + 4 + progress * 20, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(192, 132, 252, ${(1 - progress).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawMarbleTrails(
  ctx: CanvasRenderingContext2D,
  marbles: Matter.Body[],
  colorById: Map<string, string>,
  trails: Map<string, { x: number; y: number }[]>,
  hotUntil: Map<string, number>,
  now: number
) {
  ctx.globalCompositeOperation = 'destination-over';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const m of marbles) {
    const pid = playerIdOf(m);
    const pts = trails.get(pid);
    if (!pts || pts.length < 2) continue;
    const baseColor = colorById.get(pid) ?? '#ffffff';
    const isHot = now < (hotUntil.get(pid) ?? 0);

    for (let i = 1; i < pts.length; i++) {
      const ratio = i / (pts.length - 1);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.globalAlpha = ratio * (isHot ? 0.72 : 0.42);
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2 + ratio * (isHot ? 14 : 9);
      ctx.stroke();

      if (isHot) {
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.globalAlpha = ratio * 0.65;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 + ratio * 5;
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

function updateAndDrawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], deltaMs: number) {
  if (particles.length === 0) return;
  const stepRatio = deltaMs / FIXED_STEP_MS;
  ctx.globalCompositeOperation = 'source-over';

  let writeIdx = 0;
  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i];
    pt.life -= deltaMs;
    if (pt.life <= 0) continue;

    pt.x += pt.vx * stepRatio;
    pt.y += pt.vy * stepRatio;
    pt.vy += 0.08 * stepRatio;
    pt.vx *= Math.pow(0.96, stepRatio);

    const alpha = Math.max(0, pt.life / pt.maxLife);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.radius * (0.5 + 0.5 * alpha), 0, Math.PI * 2);
    ctx.fillStyle = pt.color;
    ctx.fill();

    particles[writeIdx++] = pt;
  }
  particles.length = writeIdx;
  ctx.globalAlpha = 1;
}

function drawMarbleLabelsAndMarkers(
  ctx: CanvasRenderingContext2D,
  marbles: Matter.Body[],
  nameById: Map<string, string>,
  colorById: Map<string, string>,
  finishedIds: string[],
  gameMode: GameMode,
  now: number
) {
  const active = marbles.filter((m) => !finishedIds.includes(playerIdOf(m)));
  let leaderId: string | null = null;
  let lastId: string | null = null;

  if (active.length > 0) {
    let maxY = -Infinity;
    let minY = Infinity;
    for (const m of active) {
      const pid = playerIdOf(m);
      if (m.position.y > maxY) {
        maxY = m.position.y;
        leaderId = pid;
      }
      if (m.position.y < minY) {
        minY = m.position.y;
        lastId = pid;
      }
    }
    if (active.length < 2) lastId = null;
  }

  // 몰빵 모드 꼴찌 구슬 주위 붉은 위기 펄스 링 (구슬 뒤 레이어)
  if (gameMode === 'all-in' && lastId) {
    const lastMarble = active.find((m) => playerIdOf(m) === lastId);
    if (lastMarble) {
      const pulse = (Math.sin(now * 0.01) + 1) * 0.5;
      ctx.globalCompositeOperation = 'destination-over';
      ctx.beginPath();
      ctx.arc(lastMarble.position.x, lastMarble.position.y, 15 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(239, 68, 68, ${(0.35 + pulse * 0.5).toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // 구슬 위 실시간 이름표 (최상단 레이어)
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of marbles) {
    const pid = playerIdOf(m);
    const rawName = nameById.get(pid) ?? '';
    const shortName = rawName.length > 7 ? rawName.slice(0, 6) + '…' : rawName;
    const isLeader = pid === leaderId;
    const isDanger = gameMode === 'all-in' && pid === lastId;
    const prefix = isLeader ? '👑 ' : isDanger ? '☕ ' : '';
    const label = `${prefix}${shortName}`;

    const textWidth = ctx.measureText(label).width;
    const boxW = textWidth + 10;
    const boxH = 15;
    const boxX = Math.max(4, Math.min(TRACK_WIDTH - boxW - 4, m.position.x - boxW / 2));
    const boxY = m.position.y - 26;

    drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, 7.5);
    ctx.fillStyle = isDanger ? 'rgba(127, 29, 29, 0.88)' : 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.strokeStyle = isLeader ? '#fbbf24' : isDanger ? '#ef4444' : colorById.get(pid) ?? '#ffffff';
    ctx.lineWidth = isLeader || isDanger ? 1.5 : 1;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.fillText(label, boxX + boxW / 2, boxY + boxH / 2 + 0.5);
  }
}

function drawCanvasHud(
  ctx: CanvasRenderingContext2D,
  now: number,
  isSlowMo: boolean,
  isClimax: boolean,
  commentary: CommentaryItem | null,
  width: number,
  height: number
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  // 단두대 매치 / 클라이맥스 중 화면 가장자리 붉은 맥동 글로우
  if (isClimax) {
    const pulse = (Math.sin(now * 0.012) + 1) * 0.5;
    ctx.strokeStyle = `rgba(239, 68, 68, ${(0.35 + pulse * 0.45).toFixed(2)})`;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, width - 6, height - 6);
  }

  let nextTopY = 12;

  // 역전 슬로우모션 배지
  if (isSlowMo) {
    const badgeText = '⚡ SLOW MOTION · 역전 순간!';
    ctx.font = '800 11px -apple-system, BlinkMacSystemFont, sans-serif';
    const bw = ctx.measureText(badgeText).width + 20;
    const bx = (width - bw) / 2;
    drawRoundedRectPath(ctx, bx, nextTopY, bw, 22, 11);
    ctx.fillStyle = 'rgba(245, 158, 11, 0.92)';
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, width / 2, nextTopY + 11.5);
    nextTopY += 28;
  }

  // 실시간 중계 자막 HUD
  if (commentary && now < commentary.expiresAt) {
    const toneColors: Record<CommentaryTone, string> = {
      overtake: '#f59e0b',
      boost: '#06b6d4',
      jump: '#f43f5e',
      bumper: '#a855f7',
      finish: '#10b981',
      climax: '#ef4444',
    };
    const accent = toneColors[commentary.tone];
    ctx.font = '700 11px -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = ctx.measureText(commentary.text).width;
    const pillW = Math.min(width - 24, textW + 24);
    const pillX = (width - pillW) / 2;

    drawRoundedRectPath(ctx, pillX, nextTopY, pillW, 24, 12);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(commentary.text, width / 2, nextTopY + 12.5, pillW - 14);
  }

  ctx.restore();
}

export function RaceScreen({
  players,
  gameMode = 'all-in',
  onFinish,
  isReplay = false,
  replayTrajectory = DEFAULT_TRAJECTORY,
  raceResults = DEFAULT_RESULTS,
  onExitReplay,
}: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const [finishedPlayers, setFinishedPlayers] = useState<string[]>([]);
  const finishedRef = useRef<string[]>([]);

  const loopTimeoutIdRef = useRef<number | null>(null);
  const finishTimeoutRef = useRef<number | null>(null);
  const commentaryTimeoutRef = useRef<number | null>(null);

  // 효과음 컨트롤러 & 음소거 상태
  const soundRef = useRef<SoundController | null>(null);
  if (!soundRef.current) {
    soundRef.current = new SoundController();
  }
  const [isMuted, setIsMuted] = useState<boolean>(() => soundRef.current?.isMuted() ?? false);

  // 중계 배너 & 단두대 매치 클라이맥스 상태
  const [commentaryItem, setCommentaryItem] = useState<CommentaryItem | null>(null);
  const commentaryRef = useRef<CommentaryItem | null>(null);
  const [climaxInfo, setClimaxInfo] = useState<ClimaxInfo>({ active: false, contenders: [] });
  const climaxRef = useRef<ClimaxInfo>({ active: false, contenders: [] });
  const gameModeRef = useRef<GameMode>(gameMode);

  useEffect(() => {
    gameModeRef.current = gameMode;
  }, [gameMode]);

  useEffect(() => {
    return () => {
      soundRef.current?.dispose();
    };
  }, []);

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

  const toggleMute = () => {
    const controller = soundRef.current;
    if (!controller) return;
    const next = !isMuted;
    controller.setMuted(next);
    setIsMuted(next);
  };

  useEffect(() => {
    if (!sceneRef.current) return;

    const Render = Matter.Render,
          Events = Matter.Events;

    // 씬 초기화 시 연출 상태 리셋
    finishedRef.current = [];
    setFinishedPlayers([]);
    commentaryRef.current = null;
    setCommentaryItem(null);
    climaxRef.current = { active: false, contenders: [] };
    setClimaxInfo({ active: false, contenders: [] });
    trajectoryRef.current = [];
    lastCaptureTimeRef.current = 0;
    realElapsedRef.current = 0;
    replayTimeRef.current = 0;

    // 오디오 잠금 해제 시도 (시작 버튼 클릭 제스처 직후)
    soundRef.current?.unlock();

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
    const { marbles, spinner, midSpinner, popBumpers, gatekeeper } = world;

    const nameById = new Map<string, string>(players.map((p) => [p.id, p.name]));
    const colorById = new Map<string, string>(
      players.map((p, idx) => [p.id, PLAYER_COLORS[idx % PLAYER_COLORS.length]])
    );
    const marbleById = new Map<string, Matter.Body>(marbles.map((m) => [playerIdOf(m), m]));

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
        pixelRatio: 1, // 고정 해상도를 위해 pixelRatio 1로 고정
      },
    });

    // CSS 스케일링: 내부 해상도는 375px이지만 화면 컨테이너 너비에 맞게 확대/축소
    render.canvas.style.width = '100%';
    render.canvas.style.height = 'auto';
    renderRef.current = render;

    // ------------------ 실시간 연출 트래킹 상태 ------------------
    const bumperHitAt: number[] = popBumpers.map(() => -Infinity);
    const boostHitAt: number[] = BOOST_PAD_POSITIONS.map(() => -Infinity);
    const jumpHitAt: number[] = JUMP_PAD_POSITIONS.map(() => -Infinity);
    let gatekeeperHitAt = -Infinity;
    let lastBumperCommentaryAt = -Infinity;
    let commentarySeq = 0;

    const marbleTrails = new Map<string, { x: number; y: number }[]>();
    const hotUntil = new Map<string, number>();
    const particles: Particle[] = [];
    let lastRenderNow = performance.now();

    const recordTrailPoint = (playerId: string, x: number, y: number) => {
      let pts = marbleTrails.get(playerId);
      if (!pts) {
        pts = [{ x, y }];
        marbleTrails.set(playerId, pts);
        return;
      }
      const prev = pts[pts.length - 1];
      // 리플레이 시크바로 순간이동한 경우 잔상 선이 화면을 가로지르지 않게 초기화
      if (Math.hypot(x - prev.x, y - prev.y) > 80) {
        marbleTrails.set(playerId, [{ x, y }]);
        return;
      }
      pts.push({ x, y });
      if (pts.length > MAX_TRAIL_LENGTH) {
        pts.shift();
      }
    };

    const pushCommentary = (
      text: string,
      tone: CommentaryTone,
      priority: 'high' | 'normal'
    ) => {
      const now = performance.now();
      const prev = commentaryRef.current;
      if (prev && now < prev.expiresAt) {
        if (prev.text === text && now - (prev.expiresAt - COMMENTARY_DURATION_MS) < 900) {
          return;
        }
        const prevIsHigh =
          prev.tone === 'climax' || prev.tone === 'finish' || prev.tone === 'overtake';
        if (priority === 'normal' && prevIsHigh && now - (prev.expiresAt - COMMENTARY_DURATION_MS) < 900) {
          return;
        }
      }

      const item: CommentaryItem = {
        id: ++commentarySeq,
        text,
        tone,
        expiresAt: now + COMMENTARY_DURATION_MS,
      };
      commentaryRef.current = item;
      setCommentaryItem(item);

      if (commentaryTimeoutRef.current) {
        clearTimeout(commentaryTimeoutRef.current);
      }
      commentaryTimeoutRef.current = window.setTimeout(() => {
        if (commentaryRef.current?.id === item.id) {
          commentaryRef.current = null;
          setCommentaryItem(null);
        }
      }, COMMENTARY_DURATION_MS);
    };

    const updateClimaxState = (finishedIds: string[], leaderY: number | null) => {
      const remaining = players.filter((p) => !finishedIds.includes(p.id));
      const mode = gameModeRef.current;

      if (climaxRef.current.active) {
        const nextNames = remaining.map((p) => p.name);
        if (nextNames.join(',') !== climaxRef.current.contenders.join(',')) {
          const updated = { active: true, contenders: nextNames };
          climaxRef.current = updated;
          setClimaxInfo(updated);
        }
        return;
      }

      const triggerAllIn =
        mode === 'all-in' &&
        ((players.length >= 3 && remaining.length === 2) ||
          (players.length === 2 && leaderY !== null && leaderY >= 1800));
      const triggerRandom =
        mode === 'random' &&
        ((leaderY !== null && leaderY >= 2950) || (players.length >= 3 && remaining.length === 2));

      if (triggerAllIn || triggerRandom) {
        const contenders = remaining.map((p) => p.name);
        const info = { active: true, contenders };
        climaxRef.current = info;
        setClimaxInfo(info);

        if (!isReplay) {
          soundRef.current?.playClimaxAlert();
          const bannerText =
            mode === 'all-in' && contenders.length === 2
              ? `🚨 단두대 매치! ${contenders[0]} vs ${contenders[1]}`
              : '🚨 파이널 클라이맥스! 결승선 돌입!';
          pushCommentary(bannerText, 'climax', 'high');
        }
      }
    };

    // ------------------ 팝 범퍼 & 게이트키퍼 피격 색칠 ------------------
    const isFlashing = (at: number, now: number) => now - at < BUMPER_FLASH_MS;

    const paintBumpers = (now: number) => {
      popBumpers.forEach((b, i) => {
        const flash = isFlashing(bumperHitAt[i], now);
        b.render.fillStyle = flash ? BUMPER_FLASH_COLOR : BUMPER_BODY_COLOR;
        b.render.strokeStyle = flash ? '#ffffff' : BUMPER_RING_COLOR;
        b.render.lineWidth = 4;
      });
      const gkFlash = isFlashing(gatekeeperHitAt, now);
      gatekeeper.render.fillStyle = gkFlash ? '#fef08a' : '#312e81';
      gatekeeper.render.strokeStyle = gkFlash ? '#ffffff' : '#facc15';
      gatekeeper.render.lineWidth = 3;
    };

    // 렌더 직후: 팝 범퍼 중심점/링 + 트랙 기믹 + 모션 트레일 + 파티클 + 이름표 + HUD + 불투명 배경
    const drawBumperAndGimmickEffects = (now: number, deltaMs: number) => {
      const ctx = render.context;
      ctx.save();
      // 카메라 변환 적용(고정 폭·pixelRatio 1이라 스케일 없이 bounds만큼 평행이동)
      ctx.setTransform(1, 0, 0, 1, -render.bounds.min.x, -render.bounds.min.y);

      // 1) 팝 범퍼 중심점·후광·피격 링
      popBumpers.forEach((b, i) => {
        const { x, y } = b.position;
        const flash = isFlashing(bumperHitAt[i], now);

        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = flash ? '#ffffff' : BUMPER_RING_COLOR;
        ctx.fill();

        ctx.globalCompositeOperation = 'destination-over';
        ctx.beginPath();
        ctx.arc(x, y, POP_BUMPER_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = flash ? 'rgba(255, 251, 235, 0.6)' : 'rgba(251, 191, 36, 0.28)';
        ctx.lineWidth = 4;
        ctx.stroke();

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

      // 2) 왕복 게이트키퍼 레일 & 회전 코어
      drawGatekeeperEffects(ctx, gatekeeper, now, gatekeeperHitAt);

      // 3) 초고속 부스터 패드 & 대역전 점프 패드
      drawBoostPads(ctx, now, boostHitAt);
      drawJumpPads(ctx, now, jumpHitAt);

      // 4) 구슬 네온 모션 트레일 (구슬 뒤 레이어)
      drawMarbleTrails(ctx, marbles, colorById, marbleTrails, hotUntil, now);

      // 5) 충돌 & 기믹 파티클 (구슬/트랙 위 레이어)
      updateAndDrawParticles(ctx, particles, deltaMs);

      // 6) 구슬 위 실시간 이름표 + 선두(👑)/위기(☕) 마커
      drawMarbleLabelsAndMarkers(
        ctx,
        marbles,
        nameById,
        colorById,
        finishedRef.current,
        gameModeRef.current,
        now
      );

      ctx.restore();

      // 7) 화면 고정 HUD (단두대 매치 비네트 테두리, 슬로우모션 배지, 중계 자막)
      drawCanvasHud(
        ctx,
        now,
        !isReplay && world.timeScale() < 0.75,
        climaxRef.current.active,
        commentaryRef.current,
        width,
        viewHeight
      );
    };

    // ------------------ 캔버스 비트맵 배경 채우기 ------------------
    // Matter는 매 프레임 비트맵을 '투명'으로 지우고 배경은 CSS로만 입힌다(canvas.style.background).
    // 그래서 captureStream으로 캡처되는 비트맵은 투명 → 알파 미지원 mp4 녹화 시 검정으로 합성되어
    // 라이브(배경 비쳐 보임)와 색이 달라진다. afterRender에서 destination-over로 '바디 뒤'에 불투명
    // 배경을 직접 그려넣어, 라이브와 녹화의 배경 및 반투명(rgba) 요소 색을 완전히 일치시킨다.
    Events.on(render, 'afterRender', () => {
      const now = performance.now();
      const deltaMs = Math.min(50, Math.max(1, now - lastRenderNow));
      lastRenderNow = now;

      drawBumperAndGimmickEffects(now, deltaMs);
      const ctx = render.context;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // 카메라(bounds) 변환 무시, 전체 비트맵 기준으로 채움
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = CANVAS_BG_COLOR;
      ctx.fillRect(0, 0, render.canvas.width, render.canvas.height);
      ctx.restore();
    });

    // ------------------ 라이브 레이스 영상 녹화 시작 ------------------
    // 캔버스에 그려지는 모든 픽셀(카메라 패닝·슬로우모션·구슬 경로·이펙트·자막)을 그대로 녹화해
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

      // 구슬들 위치 강제 세팅 (보간 적용) + 트레일 갱신
      marbles.forEach((marble) => {
        const playerId = playerIdOf(marble);
        const p1 = f1.positions[playerId];
        const p2 = f2.positions[playerId];

        if (p1 && p2 && f1.t !== f2.t) {
          const x = p1.x + (p2.x - p1.x) * ratio;
          const y = p1.y + (p2.y - p1.y) * ratio;
          Matter.Body.setPosition(marble, { x, y });
          recordTrailPoint(playerId, x, y);
        } else if (p1) {
          Matter.Body.setPosition(marble, { x: p1.x, y: p1.y });
          recordTrailPoint(playerId, p1.x, p1.y);
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
        .map((p) => {
          const pos = f1.positions[p.id];
          return { id: p.id, y: pos ? pos.y : 0 };
        })
        .filter((item) => item.y >= SENSOR_Y)
        .sort((a, b) => raceResults.indexOf(a.id) - raceResults.indexOf(b.id))
        .map((item) => item.id);

      // 내용이 실제로 바뀐 경우에만 setState (매 틱 새 배열로 인한 불필요한 리렌더 방지)
      if (passedIds.join(',') !== finishedRef.current.join(',')) {
        finishedRef.current = passedIds;
        setFinishedPlayers(passedIds);
      }

      const activeMaxY = marbles.length > 0 ? Math.max(...marbles.map((m) => m.position.y)) : null;
      updateClimaxState(finishedRef.current, activeMaxY);

      // 끝에 도달했을 때 일시정지
      if (t >= totalDuration && isPlayingRef.current) {
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
    };

    // ------------------ 라이브 물리 1스텝 ------------------
    const stepLive = () => {
      const {
        newlyFinished,
        bumperHits,
        boostHits,
        jumpHits,
        gatekeeperHitPlayerIds,
        leadChangedTo,
        pinHits,
      } = world.stepLive();

      const now = performance.now();
      const sound = soundRef.current;

      // 구슬 궤적 잔상 기록
      for (const m of marbles) {
        recordTrailPoint(playerIdOf(m), m.position.x, m.position.y);
      }

      // 핀 일반 충돌 효과음
      if (pinHits > 0) {
        sound?.playPinHit();
      }

      // 팝 범퍼 피격 연출 & 사운드
      if (bumperHits.length > 0) {
        sound?.playBumperHit();
        bumperHits.forEach((i) => {
          bumperHitAt[i] = now;
          const pos = popBumpers[i]?.position;
          if (pos) {
            spawnParticles(particles, pos.x, pos.y, ['#fbbf24', '#fef08a', '#ffffff'], 12, 1.5, 4.5);
          }
        });
        if (bumperHits.length >= 2 || now - lastBumperCommentaryAt < 1500) {
          pushCommentary('💥 팝 범퍼 강타! 트랙이 요동칩니다!', 'bumper', 'normal');
        }
        lastBumperCommentaryAt = now;
      }

      // 부스터 패드 통과 연출 & 사운드
      if (boostHits.length > 0) {
        sound?.playBoost();
        for (const { index, playerId } of boostHits) {
          boostHitAt[index] = now;
          hotUntil.set(playerId, now + HOT_TRAIL_DURATION_MS);
          const m = marbleById.get(playerId);
          if (m) {
            spawnParticles(particles, m.position.x, m.position.y, ['#06b6d4', '#67e8f9', '#cffafe'], 14, 1.2, 3.8, 1.8);
          }
          const name = nameById.get(playerId) ?? '참가자';
          pushCommentary(`⚡ ${name} 초고속 부스터 가속!`, 'boost', 'normal');
        }
      }

      // 점프 패드 발동 연출 & 사운드
      if (jumpHits.length > 0) {
        sound?.playJumpPad();
        for (const { index, playerId } of jumpHits) {
          jumpHitAt[index] = now;
          hotUntil.set(playerId, now + HOT_TRAIL_DURATION_MS);
          const m = marbleById.get(playerId);
          if (m) {
            spawnParticles(particles, m.position.x, m.position.y, ['#f43f5e', '#fb923c', '#fde047'], 16, 1.8, 4.8, -1.5);
          }
          const name = nameById.get(playerId) ?? '참가자';
          pushCommentary(`🚀 대역전 스프링! ${name} 하늘로 비상!`, 'jump', 'normal');
        }
      }

      // 왕복 게이트키퍼 충돌 연출 & 사운드
      if (gatekeeperHitPlayerIds.length > 0) {
        sound?.playBumperHit();
        gatekeeperHitAt = now;
        spawnParticles(
          particles,
          gatekeeper.position.x,
          gatekeeper.position.y,
          ['#a855f7', '#facc15', '#ffffff'],
          12,
          1.5,
          4.2
        );
        const name = nameById.get(gatekeeperHitPlayerIds[0]) ?? '참가자';
        pushCommentary(`🛡️ 수문장 직격! ${name} 튕겨 나갑니다!`, 'bumper', 'normal');
      }

      // 역전 슬로우모션 사운드 & 중계 배너
      if (leadChangedTo) {
        sound?.playSlowMo();
        const leadName = nameById.get(leadChangedTo) ?? '참가자';
        pushCommentary(`🔥 역전! ${leadName} 선두 탈환!`, 'overtake', 'high');
      }

      // 결승선 통과 처리
      if (newlyFinished.length > 0) {
        finishedRef.current = [...world.finished];
        setFinishedPlayers([...world.finished]);

        const isAllFinished = world.finished.length === players.length;
        sound?.playFinish(isAllFinished);

        newlyFinished.forEach((fid) => {
          const m = marbleById.get(fid);
          const pColor = colorById.get(fid) ?? '#10b981';
          if (m) {
            spawnParticles(particles, m.position.x, m.position.y, [pColor, '#fbbf24', '#ffffff'], 18, 2.0, 5.2, -1.0);
          }
        });

        const lastPid = newlyFinished[newlyFinished.length - 1];
        const lastName = nameById.get(lastPid) ?? '참가자';
        if (isAllFinished) {
          pushCommentary(
            gameModeRef.current === 'all-in'
              ? `☕ 당첨 확정! 오늘 커피는 ${lastName}님!`
              : '🏁 전원 도착! 결과를 집계합니다!',
            'finish',
            'high'
          );
          if (finishTimeoutRef.current) {
            clearTimeout(finishTimeoutRef.current);
          }
          finishTimeoutRef.current = window.setTimeout(() => {
            finalizeRace();
          }, 2000);
        } else {
          const rank = world.finished.length;
          pushCommentary(`🏁 ${rank}위 ${lastName} 결승 통과!`, 'finish', 'high');
        }
      }

      // 최후의 2인 '단두대 매치' / 클라이맥스 체크
      updateClimaxState(world.finished, world.leaderY());

      // 실시간 경과 누적 (stepLive 1회 = 고정 16.66ms 실시간, timeScale 무관)
      // → 슬로우모션 구간은 같은 실시간 동안 물리가 0.2배로 진행되어 프레임이 더 촘촘히 쌓이고,
      //   재생이 이를 실시간 등속으로 통과하면 그 구간이 자연히 느리게 재현됨(역전 연출이 데이터에 내장됨)
      realElapsedRef.current += FIXED_STEP_MS;
      const realElapsed = realElapsedRef.current;

      // 궤적(Trajectory) 주기적 캡처 (실시간 SAMPLE_MS 간격)
      if (realElapsed - lastCaptureTimeRef.current >= SAMPLE_MS) {
        lastCaptureTimeRef.current = realElapsed;
        const positions: { [playerId: string]: { x: number; y: number } } = {};
        marbles.forEach((m) => {
          positions[playerIdOf(m)] = {
            x: Math.round(m.position.x),
            y: Math.round(m.position.y),
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

      const targetMinY = leaderY - viewHeight * 0.7;
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
      if (commentaryTimeoutRef.current) {
        clearTimeout(commentaryTimeoutRef.current);
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

  const climaxBannerText = climaxInfo.active
    ? gameMode === 'all-in' && climaxInfo.contenders.length === 2
      ? `🚨 단두대 매치: ${climaxInfo.contenders[0]} vs ${climaxInfo.contenders[1]} (마지막 1명 커피 당첨!)`
      : '🚨 파이널 클라이맥스! 결승선 돌입!'
    : null;

  return (
    <div className="race-container" onPointerDown={() => soundRef.current?.unlock()}>
      <div className="race-header">
        <div className="race-title-row">
          <h2>{isReplay ? '📺 리플레이 재생' : '🔥 마블 레이스 🔥'}</h2>
          {!isReplay && (
            <button
              type="button"
              onClick={toggleMute}
              className={`btn-sound-toggle ${isMuted ? 'muted' : ''}`}
              aria-label={isMuted ? '효과음 켜기' : '효과음 끄기'}
              title={isMuted ? '효과음 켜기' : '효과음 끄기'}
            >
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          )}
        </div>
        <div className="live-rank">
          {finishedPlayers.map((id, index) => {
            const p = players.find((p) => p.id === id);
            const color = PLAYER_COLORS[players.findIndex((player) => player.id === id) % PLAYER_COLORS.length];
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

      {(climaxBannerText || commentaryItem) && (
        <div className="race-feed-area">
          {climaxBannerText && (
            <div className="climax-banner fadeIn">{climaxBannerText}</div>
          )}
          {commentaryItem && (
            <div key={commentaryItem.id} className={`commentary-banner tone-${commentaryItem.tone}`}>
              {commentaryItem.text}
            </div>
          )}
        </div>
      )}

      <div
        className={`glass-panel canvas-container ${climaxInfo.active ? 'climax-mode' : ''}`}
        ref={sceneRef}
      >
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
