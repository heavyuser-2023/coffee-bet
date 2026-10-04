// 레이스 물리 헤드리스 시뮬레이션 테스트 (node --test)
// 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  createRaceWorld,
  FIXED_STEP_MS,
  POP_BUMPER_POSITIONS,
  TRACK_WIDTH,
  WORLD_HEIGHT,
  type RaceWorldOptions,
} from '../src/game/raceWorld.ts';

// 시드 고정 난수 (mulberry32) — 실패 시 같은 시드로 재현 가능
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_RACE_SECONDS = 150;

function runRace(nPlayers: number, seed: number, extra: Partial<RaceWorldOptions> = {}) {
  const ids = Array.from({ length: nPlayers }, (_, i) => `p${i}`);
  const world = createRaceWorld({ playerIds: ids, colors: ['#fff'], random: seeded(seed), ...extra });
  const maxSteps = Math.round((MAX_RACE_SECONDS * 1000) / FIXED_STEP_MS);
  let escaped: string | null = null;
  while (world.finished.length < nPlayers && world.metrics.steps < maxSteps) {
    world.stepLive();
    for (const m of world.marbles) {
      const { x, y } = m.position;
      if (!escaped && (x < 0 || x > TRACK_WIDTH || y > WORLD_HEIGHT + 30 || y < -1500)) {
        escaped = `${m.label} at (${x.toFixed(0)}, ${y.toFixed(0)}) step ${world.metrics.steps}`;
      }
    }
  }
  const result = {
    finished: [...world.finished],
    seconds: (world.metrics.steps * FIXED_STEP_MS) / 1000,
    metrics: { ...world.metrics },
    escaped,
  };
  world.dispose();
  return result;
}

test('모든 인원 구성에서 레이스가 제한 시간 안에 끝나고 구슬이 트랙을 이탈하지 않는다', () => {
  for (const n of [2, 5, 8, 12, 20]) {
    for (let seed = 1; seed <= 6; seed++) {
      const r = runRace(n, seed * 101 + n);
      assert.equal(r.escaped, null, `n=${n} seed=${seed}: 구슬 이탈 ${r.escaped}`);
      assert.equal(r.finished.length, n, `n=${n} seed=${seed}: ${r.seconds.toFixed(0)}s 안에 ${r.finished.length}/${n}명만 도착`);
      assert.equal(new Set(r.finished).size, n, '결승 기록에 중복이 없어야 함');
    }
  }
});

test('팝 범퍼가 구슬을 실제로 튕겨낸다', () => {
  let kicks = 0;
  for (let seed = 1; seed <= 6; seed++) kicks += runRace(8, seed).metrics.bumperKicks;
  // 레이스당 최소 몇 번은 범퍼에 맞아야 '중간중간 튕겨내는 요소'로서 의미가 있다
  assert.ok(kicks / 6 >= 3, `레이스당 평균 범퍼 킥 ${(kicks / 6).toFixed(1)}회 (기대: 3회 이상)`);
});

test('팝 범퍼에 맞은 구슬은 범퍼 반대 방향으로 최소 킥 속도 이상으로 튕겨나간다', () => {
  // 범퍼 바로 위에서 구슬 하나를 떨어뜨려 첫 충돌 직후 속도를 검사
  const b = POP_BUMPER_POSITIONS[0];
  for (const timeScale of [1, 0.2]) {
    const world = createRaceWorld({
      playerIds: ['solo'], colors: ['#fff'], random: seeded(1), slowMotion: false,
      startPositions: { solo: { x: b.x + 4, y: b.y - 45 } },
    });
    world.engine.timing.timeScale = timeScale;
    const marble = world.marbles[0];
    let hit = false;
    for (let i = 0; i < 400 && !hit; i++) hit = world.stepLive().bumperHits.length > 0;
    assert.ok(hit, `timeScale=${timeScale}: 범퍼에 닿지 않음`);
    const v = Matter.Body.getVelocity(marble);
    const speed = Math.hypot(v.x, v.y);
    assert.ok(speed >= 7, `timeScale=${timeScale}: 킥 속도 ${speed.toFixed(2)} (기대 ≥ 7)`);
    assert.ok(v.y < 0, `timeScale=${timeScale}: 위쪽에서 맞았으니 위로 튕겨야 함 (vy=${v.y.toFixed(2)})`);
    world.dispose();
  }
});

test('슬로우모션 중에 끼임 탈출(위로 튕기기)이 오발동하지 않는다', () => {
  // 수정 전 코드는 슬로우모션을 끄면 10판 동안 끼임 탈출이 0회였지만, 켜면 판당 10~20회 발동했다.
  // 즉 발동 전부가 '슬로우모션으로 느려진 구슬'을 끼임으로 오판해 위로 튕겨 올린 것 → 중력이 이상해 보이는 원인
  let slowSteps = 0, normalSteps = 0, slowRescues = 0, totalRescues = 0, races = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { metrics } = runRace(8, seed);
    races++;
    slowSteps += metrics.slowMoSteps;
    normalSteps += metrics.steps - metrics.slowMoSteps;
    slowRescues += metrics.stuckRescuesInSlowMo;
    totalRescues += metrics.stuckRescues;
  }
  assert.ok(slowSteps > normalSteps * 0.1, '슬로우모션 구간이 충분히 발생해야 검증 의미가 있음');
  assert.ok(totalRescues / races < 1, `판당 끼임 탈출 ${(totalRescues / races).toFixed(1)}회 (오발동 의심)`);
  assert.ok(slowRescues <= 1, `슬로우모션 중 끼임 탈출 ${slowRescues}회 발동`);
});

test('실제로 갇혀 멈춘 구슬은 슬로우모션 여부와 상관없이 구출된다', () => {
  // 트랙 바깥에 구슬이 꼭 맞는 좁은 컵을 만들어 가둬 두면 움직이지 못한다 → 끼임 탈출이 발동해야 함
  for (const timeScale of [1, 0.2]) {
    const world = createRaceWorld({
      playerIds: ['stuck'], colors: ['#fff'], random: seeded(2), slowMotion: false,
      startPositions: { stuck: { x: -300, y: 488 } },
    });
    const wall = { isStatic: true, friction: 1 };
    Matter.Composite.add(world.engine.world, [
      Matter.Bodies.rectangle(-300, 510, 60, 20, wall), // 바닥
      Matter.Bodies.rectangle(-322, 470, 20, 100, wall), // 왼벽
      Matter.Bodies.rectangle(-278, 470, 20, 100, wall), // 오른벽
    ]);
    world.engine.timing.timeScale = timeScale;
    // 물리 시간 기준 45스텝(배속 0.2면 실시간 225스텝) 남짓 지나면 발동해야 함
    const budget = Math.ceil(90 / timeScale);
    let steps = 0;
    while (steps < budget && world.metrics.stuckRescues === 0) {
      world.stepLive();
      steps++;
    }
    assert.equal(world.metrics.stuckRescues, 1, `timeScale=${timeScale}: ${budget}스텝 안에 구출되지 않음`);
    // 너무 이르게(=움직이는 중에) 발동하지 않았는지: 물리 시간으로 최소 45스텝은 지나야 함
    assert.ok(steps * timeScale >= 45, `timeScale=${timeScale}: 물리 시간 ${(steps * timeScale).toFixed(0)}스텝 만에 발동 (너무 이름)`);
    world.dispose();
  }
});

test('슬로우모션은 물리를 바꾸지 않고 시간만 늦춘다 (자유낙하 궤적 동일)', () => {
  // 같은 '물리 시간' 동안 배속 1로 N스텝 vs 배속 0.2로 5N스텝 진행한 구슬 위치가 같아야 한다.
  // 트랙 바깥(벽 너머 빈 공간)에서 떨어뜨려 충돌 없이 중력·공기저항만 비교
  const drop = (timeScale: number, steps: number) => {
    const world = createRaceWorld({
      playerIds: ['a'], colors: ['#fff'], random: seeded(3), slowMotion: false,
      startPositions: { a: { x: -300, y: 0 } },
    });
    world.engine.timing.timeScale = timeScale;
    for (let i = 0; i < steps; i++) world.stepLive();
    const { x, y } = world.marbles[0].position;
    world.dispose();
    return { x, y };
  };
  const normal = drop(1, 60);
  const slow = drop(0.2, 300);
  // 스텝 크기가 달라 생기는 엔진 수치 오차(~1.6%)는 육안으로 구분되지 않는 수준이라 허용
  const diff = Math.abs(normal.y - slow.y) / normal.y;
  assert.ok(diff < 0.025, `1초 낙하 거리: 평소 ${normal.y.toFixed(1)} vs 슬로우 ${slow.y.toFixed(1)} (차이 ${(diff * 100).toFixed(1)}%)`);
});

test('스피너 회전도 슬로우모션 배속을 따른다', () => {
  const world = createRaceWorld({ playerIds: ['a', 'b'], colors: ['#fff'], random: seeded(5), slowMotion: false });
  world.engine.timing.timeScale = 0.2;
  const a0 = world.spinner.angle;
  for (let i = 0; i < 50; i++) world.stepLive();
  // 배속 1이었다면 50 × 0.02 = 1.0rad, 0.2배속이면 0.2rad
  assert.ok(Math.abs(world.spinner.angle - a0 - 0.2) < 1e-9, `회전량 ${(world.spinner.angle - a0).toFixed(3)}rad`);
  world.dispose();
});

test('역전 시 슬로우모션이 부드럽게 진입했다가 원래 배속으로 복귀한다', () => {
  const world = createRaceWorld({ playerIds: ['a', 'b', 'c', 'd', 'e', 'f'], colors: ['#fff'], random: seeded(9) });
  const scales: number[] = [];
  while (world.finished.length < 6 && world.metrics.steps < 9000) {
    world.stepLive();
    scales.push(world.timeScale());
  }
  assert.ok(Math.min(...scales) <= 0.21, '슬로우모션이 한 번도 발동하지 않음');
  // 한 스텝 사이 배속 변화가 급격하지 않아야 함 (1 → 0.2 순간 전환 금지)
  let maxJump = 0;
  for (let i = 1; i < scales.length; i++) maxJump = Math.max(maxJump, Math.abs(scales[i] - scales[i - 1]));
  assert.ok(maxJump <= 0.21, `한 스텝 배속 변화 최대 ${maxJump.toFixed(3)}`);
  assert.ok(scales.some((s, i) => i > 0 && scales[i - 1] < 1 && s === 1), '슬로우모션 후 원래 배속(1)으로 복귀해야 함');
  world.dispose();
});
