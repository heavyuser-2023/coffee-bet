import Matter from 'matter-js';

// 레이스 트랙(물리 월드) 구성과 1스텝 진행 로직.
// React/DOM에 의존하지 않아 RaceScreen(브라우저)과 헤드리스 시뮬레이션 테스트(Node)가 같은 코드를 쓴다.

// tick 루프의 고정 물리 스텝(실시간 기준). stepLive 1회 = 16.66ms 실시간 (timeScale 무관)
export const FIXED_STEP_MS = 16.66;

// iPhone 기준 설계 폭(고정) — 모든 기기에서 동일한 레이아웃 보장
export const TRACK_WIDTH = 375;
export const VIEW_HEIGHT = 500;
export const WORLD_HEIGHT = 3500; // 긴 트랙!

const BOTTLENECK_Y = 1200;
const GAP = 38;
const FINAL_FUNNEL_Y = WORLD_HEIGHT - 350;
const FINAL_CHANNEL_LENGTH = 200;
const FINAL_CHANNEL_Y = FINAL_FUNNEL_Y + FINAL_CHANNEL_LENGTH / 2;
export const SENSOR_Y = FINAL_CHANNEL_Y + FINAL_CHANNEL_LENGTH / 2 - 30;

// 스피너 회전 속도(물리 시간 기준, 기준 스텝당 rad)
const SPINNER_RATE = 0.02;
const MID_SPINNER_RATE = -0.025;

// ------------------ 역전 슬로우모션 ------------------
// 슬로우모션은 엔진 timeScale만 낮춰 '물리 시간'을 느리게 흐르게 한다.
// 시간에 의존하는 게임 로직(스피너 회전, 끼임 판정)도 모두 같은 물리 시간으로 환산해야
// 중력/충돌이 평소와 동일하게 보이는 '순수한 감속'이 된다.
const SLOWMO_SCALE = 0.2;
const SLOWMO_HOLD_MS = 1500; // 마지막 역전 후 유지 시간(실시간)
const SLOWMO_EASE_IN = 0.25; // 스텝당 목표 배속으로 다가가는 비율 (진입은 빠르게)
const SLOWMO_EASE_OUT = 0.1; // (복귀는 부드럽게)

// ------------------ 끼임(Stuck) 탈출 ------------------
// 물리 시간 기준 45스텝(≈0.75초) 동안 기준 스텝당 0.8px 미만으로만 움직이면 핀에 걸린 것으로 진단
const STUCK_SPEED = 0.8;
const STUCK_STEPS = 45;

// ------------------ 핀볼 팝 범퍼 ------------------
// 구슬이 닿으면 범퍼 중심 반대 방향으로 강하게 튕겨내는 원형 범퍼
export const POP_BUMPER_RADIUS = 16;
const POP_BUMPER_KICK = 7.5; // 튕겨내는 최소 속도(기준 스텝당 px)
// 범퍼 주변에 이 거리 안쪽의 핀은 제거해 구슬이 지나갈 통로를 확보 (범퍼 반지름 + 구슬 지름 + 여유)
const POP_BUMPER_CLEARANCE = POP_BUMPER_RADIUS + 6 + 22 + 6;
export const POP_BUMPER_POSITIONS: ReadonlyArray<{ x: number; y: number }> = [
  // 상단 핀 구간
  { x: TRACK_WIDTH / 2, y: 430 },
  { x: 110, y: 700 },
  { x: TRACK_WIDTH - 110, y: 700 },
  { x: TRACK_WIDTH / 2, y: 960 },
  // 하단 핀 구간
  { x: TRACK_WIDTH / 2, y: 1830 },
  { x: 110, y: 2120 },
  { x: TRACK_WIDTH - 110, y: 2120 },
  { x: TRACK_WIDTH / 2, y: 2420 },
  { x: 110, y: 2720 },
  { x: TRACK_WIDTH - 110, y: 2720 },
];

const MARBLE_RADIUS = 11;
// matter-js 기준 스텝 길이(Body._baseDelta). 속도는 이 시간당 이동량(px)으로 정규화된다
const BASE_DELTA = 1000 / 60;

export interface RaceWorldOptions {
  playerIds: string[];
  colors: string[];
  // 출발 배치·끼임 탈출 등에 쓰는 난수. 테스트에서 시드 고정 난수를 주입한다.
  random?: () => number;
  // 리플레이(궤적 재생) 모드: 구슬을 static으로 두고 위치를 수동으로 세팅
  isReplay?: boolean;
  startPositions?: { [playerId: string]: { x: number; y: number } };
  // 역전 슬로우모션 사용 여부 (기본 사용)
  slowMotion?: boolean;
}

export interface StepResult {
  newlyFinished: string[]; // 이번 스텝에 결승선을 통과한 참가자 ID
  bumperHits: number[]; // 이번 스텝에 구슬을 튕겨낸 팝 범퍼 인덱스
}

// 레이스 진행 계측값 (헤드리스 시뮬레이션 테스트에서 동작 검증용)
export interface RaceMetrics {
  steps: number; // 진행한 실시간 스텝 수
  slowMoSteps: number; // 그중 슬로우모션(배속 < 1) 스텝 수
  stuckRescues: number; // 끼임 탈출 발동 횟수
  stuckRescuesInSlowMo: number; // 그중 슬로우모션 중 발동 횟수
  bumperKicks: number; // 팝 범퍼가 구슬을 튕겨낸 횟수
  leaderChanges: number; // 선두 교체(역전) 횟수
}

export interface RaceWorld {
  engine: Matter.Engine;
  metrics: RaceMetrics;
  marbles: Matter.Body[];
  spinner: Matter.Body;
  midSpinner: Matter.Body;
  popBumpers: Matter.Body[];
  finished: string[];
  stepLive: () => StepResult;
  // 결승 전 구슬 중 가장 아래(선두)에 있는 구슬의 y좌표 (없으면 null)
  leaderY: () => number | null;
  timeScale: () => number;
  dispose: () => void;
}

export const playerIdOf = (marble: Matter.Body) => marble.label.slice('player_'.length);

interface MarbleState {
  lastX?: number;
  lastY?: number;
  stuckSteps: number;
}

export function createRaceWorld({
  playerIds,
  colors,
  random = Math.random,
  isReplay = false,
  startPositions,
  slowMotion = true,
}: RaceWorldOptions): RaceWorld {
  const { Engine, Bodies, Composite, Events, Body } = Matter;
  const engine = Engine.create();
  const width = TRACK_WIDTH;
  const worldHeight = WORLD_HEIGHT;

  // Boundary walls
  const wallOptions = {
    isStatic: true,
    restitution: 0.8,
    friction: 0,
    render: { fillStyle: 'rgba(255,255,255,0.1)' },
  };
  const leftWall = Bodies.rectangle(0, worldHeight / 2, 40, worldHeight, wallOptions);
  const rightWall = Bodies.rectangle(width, worldHeight / 2, 40, worldHeight, wallOptions);

  // Top funnel
  const funnelLeft = Bodies.rectangle(width / 2 - 120, 40, 200, 20, {
    isStatic: true,
    angle: Math.PI / 5,
    render: { fillStyle: 'rgba(255,255,255,0.2)' },
  });
  const funnelRight = Bodies.rectangle(width / 2 + 120, 40, 200, 20, {
    isStatic: true,
    angle: -Math.PI / 5,
    render: { fillStyle: 'rgba(255,255,255,0.2)' },
  });

  // Bottleneck
  const bottleneckY = BOTTLENECK_Y;
  const gap = GAP;
  const funnelLength = 300;
  const funnelAngle = Math.PI / 6;
  const funnelDx = (funnelLength / 2) * Math.cos(funnelAngle);
  const funnelDy = (funnelLength / 2) * Math.sin(funnelAngle);

  const bottleNeckFunnelLeft = Bodies.rectangle(
    width / 2 - gap / 2 - funnelDx, bottleneckY - funnelDy, funnelLength, 20,
    { isStatic: true, angle: funnelAngle, render: { fillStyle: 'rgba(236,72,153,0.3)' } }
  );
  const bottleNeckFunnelRight = Bodies.rectangle(
    width / 2 + gap / 2 + funnelDx, bottleneckY - funnelDy, funnelLength, 20,
    { isStatic: true, angle: -funnelAngle, render: { fillStyle: 'rgba(236,72,153,0.3)' } }
  );

  const channelLength = 300;
  const channelY = bottleneckY + channelLength / 2;
  const channelLeft = Bodies.rectangle(width / 2 - gap / 2 - 10, channelY, 20, channelLength, wallOptions);
  const channelRight = Bodies.rectangle(width / 2 + gap / 2 + 10, channelY, 20, channelLength, wallOptions);

  const bumperLeft = Bodies.circle(width / 2 - gap / 2 - 10, bottleneckY, 10, wallOptions);
  const bumperRight = Bodies.circle(width / 2 + gap / 2 + 10, bottleneckY, 10, wallOptions);

  const midSpinner = Bodies.rectangle(width / 2, bottleneckY - 50, 100, 15, {
    isStatic: true,
    render: { fillStyle: '#3b82f6' },
  });

  Composite.add(engine.world, [
    leftWall, rightWall,
    funnelLeft, funnelRight,
    bottleNeckFunnelLeft, bottleNeckFunnelRight,
    channelLeft, channelRight,
    bumperLeft, bumperRight,
    midSpinner,
  ]);

  // Pegs (핀) — 팝 범퍼 주변은 비워 통로 확보
  const nearPopBumper = (x: number, y: number) =>
    POP_BUMPER_POSITIONS.some((b) => Math.hypot(b.x - x, b.y - y) < POP_BUMPER_CLEARANCE);
  const pegs: Matter.Body[] = [];
  const spacingX = width / 6;
  const sideMargin = 55;
  const addPegRows = (fromY: number, toY: number, restitution: number, fillStyle: string) => {
    for (let y = fromY; y < toY; y += 45) {
      const isEven = Math.floor(y / 45) % 2 === 0;
      const cols = isEven ? 5 : 6;
      const startX = isEven ? spacingX : spacingX / 2;
      for (let col = 0; col < cols; col++) {
        const x = startX + col * spacingX;
        if (x > sideMargin && x < width - sideMargin && !nearPopBumper(x, y)) {
          pegs.push(Bodies.circle(x, y, 6, { isStatic: true, restitution, render: { fillStyle } }));
        }
      }
    }
  };
  const finalFunnelY = FINAL_FUNNEL_Y;
  addPegRows(120, bottleneckY - 100, 0.6, '#8b5cf6'); // Upper pegs
  addPegRows(bottleneckY + 360, finalFunnelY - 80, 0.5, '#10b981'); // Lower pegs

  // Zigzag Bumper (벽 삼각 범퍼)
  const bumperRadius = 25;
  const bumperOffsetX = 10;
  const wallBumpers: Matter.Body[] = [];
  const addWallBumpers = (fromY: number, toY: number, fillStyle: string) => {
    for (let y = fromY; y < toY; y += 100) {
      wallBumpers.push(Bodies.polygon(bumperOffsetX, y, 3, bumperRadius, { isStatic: true, angle: Math.PI, restitution: 0.5, render: { fillStyle } }));
      wallBumpers.push(Bodies.polygon(width - bumperOffsetX, y + 50, 3, bumperRadius, { isStatic: true, angle: 0, restitution: 0.5, render: { fillStyle } }));
    }
  };
  addWallBumpers(160, bottleneckY - 100, 'rgba(236,72,153,0.4)');
  addWallBumpers(bottleneckY + 400, finalFunnelY - 100, 'rgba(16,185,129,0.4)');

  // 핀볼 팝 범퍼
  const popBumpers = POP_BUMPER_POSITIONS.map((p, i) =>
    Bodies.circle(p.x, p.y, POP_BUMPER_RADIUS, {
      isStatic: true,
      restitution: 1,
      friction: 0,
      label: `PopBumper_${i}`,
      render: { fillStyle: '#111827', strokeStyle: '#fbbf24', lineWidth: 4 },
    })
  );

  Composite.add(engine.world, [...pegs, ...wallBumpers, ...popBumpers]);

  // Final Funnel
  const finalFunnelLeft = Bodies.rectangle(
    width / 2 - gap / 2 - funnelDx, finalFunnelY - funnelDy, funnelLength, 20,
    { isStatic: true, angle: funnelAngle, render: { fillStyle: 'rgba(16,185,129,0.3)' } }
  );
  const finalFunnelRight = Bodies.rectangle(
    width / 2 + gap / 2 + funnelDx, finalFunnelY - funnelDy, funnelLength, 20,
    { isStatic: true, angle: -funnelAngle, render: { fillStyle: 'rgba(16,185,129,0.3)' } }
  );
  const finalBumperLeft = Bodies.circle(width / 2 - gap / 2 - 10, finalFunnelY, 10, wallOptions);
  const finalBumperRight = Bodies.circle(width / 2 + gap / 2 + 10, finalFunnelY, 10, wallOptions);

  const smoothWallOptions = { isStatic: true, friction: 0, render: { fillStyle: 'rgba(255,255,255,0.1)' } };
  const finalChannelLeft = Bodies.rectangle(width / 2 - gap / 2 - 10, FINAL_CHANNEL_Y, 20, FINAL_CHANNEL_LENGTH, smoothWallOptions);
  const finalChannelRight = Bodies.rectangle(width / 2 + gap / 2 + 10, FINAL_CHANNEL_Y, 20, FINAL_CHANNEL_LENGTH, smoothWallOptions);

  // Spinner
  const spinner = Bodies.rectangle(width / 2, finalFunnelY - 50, 130, 15, {
    isStatic: true,
    render: { fillStyle: '#f59e0b' },
  });

  Composite.add(engine.world, [
    finalFunnelLeft, finalFunnelRight,
    finalBumperLeft, finalBumperRight,
    finalChannelLeft, finalChannelRight,
    spinner,
  ]);

  // Finish line Sensor
  const finishLine = Bodies.rectangle(width / 2, SENSOR_Y, gap * 1.5, 30, {
    isStatic: true,
    isSensor: true,
    render: { fillStyle: 'rgba(239, 68, 68, 0.4)' },
    label: 'FinishLine',
  });

  // Slots
  const slotWalls: Matter.Body[] = [];
  const slotCount = playerIds.length;
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
  const dropOrder = playerIds.map((_, i) => i);
  for (let i = dropOrder.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [dropOrder[i], dropOrder[j]] = [dropOrder[j], dropOrder[i]];
  }

  // Marbles
  const marbles = playerIds.map((id, index) => {
    let startX = width / 2 + (random() * 20 - 10);
    let startY = -(dropOrder[index] * 25) - 20;
    const replayStart = startPositions?.[id];
    if (replayStart) {
      startX = replayStart.x;
      startY = replayStart.y;
    }
    return Bodies.circle(startX, startY, MARBLE_RADIUS, {
      isStatic: isReplay, // 리플레이 모드에서는 수동 업데이트를 위해 static으로 둠
      restitution: 0.85,
      friction: 0.0001,
      frictionStatic: 0,
      frictionAir: 0.02,
      density: 0.005,
      label: `player_${id}`,
      render: {
        fillStyle: colors[index % colors.length],
        strokeStyle: '#fff',
        lineWidth: 2,
      },
    });
  });
  Composite.add(engine.world, marbles);

  // ------------------ 스텝 상태 ------------------
  const finished: string[] = [];
  const marbleState = new Map<Matter.Body, MarbleState>(marbles.map((m) => [m, { stuckSteps: 0 }]));
  let newlyFinished: string[] = [];
  let bumperHits: number[] = [];
  let pendingKicks: { bumper: Matter.Body; marble: Matter.Body }[] = [];
  let leaderLabel: string | null = null;
  let slowMoHoldMs = 0;
  let slowMoTarget = 1;
  const metrics: RaceMetrics = {
    steps: 0, slowMoSteps: 0, stuckRescues: 0, stuckRescuesInSlowMo: 0, bumperKicks: 0, leaderChanges: 0,
  };

  const activeMarbles = () => marbles.filter((m) => !finished.includes(playerIdOf(m)));

  const onCollisionStart = (event: Matter.IEventCollision<Matter.Engine>) => {
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      const marble = bodyA.label.startsWith('player_') ? bodyA : bodyB.label.startsWith('player_') ? bodyB : null;
      if (!marble) continue;
      const other = marble === bodyA ? bodyB : bodyA;

      if (other.label === 'FinishLine') {
        const playerId = playerIdOf(marble);
        if (!finished.includes(playerId)) {
          finished.push(playerId);
          newlyFinished.push(playerId);
        }
      } else if (other.label.startsWith('PopBumper_')) {
        // 충돌 해석(반발) 이후에 속도를 덮어써야 킥이 그대로 적용되므로 afterUpdate에서 처리
        pendingKicks.push({ bumper: other, marble });
      }
    }
  };

  const onAfterUpdate = () => {
    for (const { bumper, marble } of pendingKicks) {
      const dx = marble.position.x - bumper.position.x;
      const dy = marble.position.y - bumper.position.y;
      const dist = Math.hypot(dx, dy) || 1;
      // setVelocity는 '기준 스텝당 px' 단위라 슬로우모션 중에도 물리 시간 기준으로 동일하게 튕겨낸다
      const speed = Math.max(POP_BUMPER_KICK, Body.getSpeed(marble));
      Body.setVelocity(marble, { x: (dx / dist) * speed, y: (dy / dist) * speed });
      metrics.bumperKicks++;
      const index = popBumpers.indexOf(bumper);
      if (!bumperHits.includes(index)) bumperHits.push(index);
    }
    pendingKicks = [];
  };

  if (!isReplay) {
    Events.on(engine, 'collisionStart', onCollisionStart);
    Events.on(engine, 'afterUpdate', onAfterUpdate);
  }

  // 슬로우모션 배속을 실시간 1스텝만큼 목표치로 부드럽게 이동
  const updateSlowMo = () => {
    if (slowMoHoldMs > 0) {
      slowMoHoldMs -= FIXED_STEP_MS;
      if (slowMoHoldMs <= 0) slowMoTarget = 1;
    }
    const current = engine.timing.timeScale;
    const ease = slowMoTarget < current ? SLOWMO_EASE_IN : SLOWMO_EASE_OUT;
    let next = current + (slowMoTarget - current) * ease;
    if (Math.abs(slowMoTarget - next) < 0.005) next = slowMoTarget;
    engine.timing.timeScale = next;
  };

  const rescueStuckMarbles = (active: Matter.Body[]) => {
    for (const m of active) {
      const state = marbleState.get(m)!;
      // 직전 스텝의 실제 이동량을 '기준 스텝당 px'로 환산 (슬로우모션 때문에 느린 것을 끼임으로 오판하지 않도록)
      const lastScale = ((m as Matter.Body & { deltaTime?: number }).deltaTime ?? BASE_DELTA) / BASE_DELTA;
      if (state.lastX !== undefined && state.lastY !== undefined) {
        const dist = Math.hypot(m.position.x - state.lastX, m.position.y - state.lastY);
        if (dist / lastScale < STUCK_SPEED) {
          state.stuckSteps += lastScale; // 물리 시간 기준으로 누적
        } else {
          state.stuckSteps = 0;
        }
      }
      state.lastX = m.position.x;
      state.lastY = m.position.y;

      if (state.stuckSteps > STUCK_STEPS) {
        // 질량이 커서 applyForce 대신 setVelocity를 사용하여 강제 속도를 부여해 핀에서 탈출시킴
        Body.setVelocity(m, { x: (random() - 0.5) * 4, y: -3 });
        state.stuckSteps = 0;
        metrics.stuckRescues++;
        if (engine.timing.timeScale < 1) metrics.stuckRescuesInSlowMo++;
      }
    }
  };

  const findLeader = (active: Matter.Body[]) => {
    let maxY = -Infinity;
    let label: string | null = null;
    for (const m of active) {
      if (m.position.y > maxY) {
        maxY = m.position.y;
        label = m.label;
      }
    }
    return { label, y: label ? maxY : null };
  };

  const stepLive = (): StepResult => {
    newlyFinished = [];
    bumperHits = [];

    if (slowMotion) updateSlowMo();
    const scale = engine.timing.timeScale;
    metrics.steps++;
    if (scale < 1) metrics.slowMoSteps++;

    // 스피너도 물리 시간에 맞춰 회전 (슬로우모션 중 스피너만 원속도로 돌며 구슬을 세게 치는 문제 방지)
    Body.setAngle(spinner, spinner.angle + SPINNER_RATE * scale);
    Body.setAngle(midSpinner, midSpinner.angle + MID_SPINNER_RATE * scale);

    rescueStuckMarbles(activeMarbles());

    Engine.update(engine, FIXED_STEP_MS);

    // 역전(선두 교체) 감지 → 슬로우모션
    const leader = findLeader(activeMarbles());
    if (leader.label && leaderLabel && leader.label !== leaderLabel) metrics.leaderChanges++;
    if (slowMotion && leader.label && leaderLabel && leader.label !== leaderLabel) {
      slowMoTarget = SLOWMO_SCALE;
      slowMoHoldMs = SLOWMO_HOLD_MS;
    }
    leaderLabel = leader.label;

    return { newlyFinished, bumperHits };
  };

  return {
    engine,
    metrics,
    marbles,
    spinner,
    midSpinner,
    popBumpers,
    finished,
    stepLive,
    leaderY: () => findLeader(activeMarbles()).y,
    timeScale: () => engine.timing.timeScale,
    dispose: () => {
      Events.off(engine, 'collisionStart', onCollisionStart);
      Events.off(engine, 'afterUpdate', onAfterUpdate);
      Composite.clear(engine.world, false, true);
      Engine.clear(engine);
    },
  };
}
