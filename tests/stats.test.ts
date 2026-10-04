// 당첨 통계/재치 있는 한마디 단위 테스트 (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWittyLines,
  currentStreak,
  getPeriod,
  personTimeline,
  summarize,
  type GameRecord,
} from '../src/game/stats.ts';
import { computeOutcome } from '../src/game/outcome.ts';

// 기기 현지 시간 기준으로 날짜를 만든다 (월은 1부터)
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

let seq = 0;
// loser: 이번 판에 걸린 사람, others: 살아남은 사람
function game(createdAt: number, loser: string | string[], others: string[], amount = 0): GameRecord {
  const losers = Array.isArray(loser) ? loser : [loser];
  const names = [...others, ...losers];
  return {
    clientGameId: `g${++seq}`,
    createdAt,
    gameMode: 'all-in',
    results: names.map((name, i) => ({
      name,
      rank: i + 1,
      amount: losers.includes(name) ? amount : 0,
      isLoser: losers.includes(name),
    })),
  };
}

const first = () => 0; // 템플릿 첫 번째 문구 고정

test('주간 기간은 월요일 00:00에 시작해 일요일까지다', () => {
  const sunday = at(2026, 10, 4, 21);
  const week = getPeriod('week', 0, sunday);
  assert.equal(week.start, at(2026, 9, 28, 0));
  assert.equal(week.end, at(2026, 10, 5, 0));
  assert.equal(week.title, '이번 주');
  assert.equal(week.subtitle, '9/28(월) – 10/4(일)');

  const monday = at(2026, 10, 5, 0, 1);
  assert.equal(getPeriod('week', 0, monday).start, at(2026, 10, 5, 0), '월요일 0시가 지나면 새 주');
  const prev = getPeriod('week', -1, sunday);
  assert.equal(prev.title, '지난주');
  assert.equal(prev.start, at(2026, 9, 21, 0));
  assert.equal(getPeriod('week', -3, sunday).title, '3주 전');
});

test('월간 기간은 1일 00:00에 시작하고 연도를 넘어가도 계산된다', () => {
  const m = getPeriod('month', 0, at(2026, 10, 4));
  assert.equal(m.start, at(2026, 10, 1, 0));
  assert.equal(m.end, at(2026, 11, 1, 0));
  assert.equal(m.title, '이번 달');
  const jan = getPeriod('month', -1, at(2027, 1, 15));
  assert.equal(jan.subtitle, '2026년 12월');
  assert.equal(jan.title, '지난달');
  assert.equal(getPeriod('month', -2, at(2027, 1, 15)).title, '2026년 11월');
});

test('사람별 집계: 이름 공백 차이는 같은 사람으로, 많이 걸린 순으로 정렬', () => {
  const records = [
    game(at(2026, 10, 1), '김철수', ['이영희', '박민수'], 9000),
    game(at(2026, 10, 2), ' 김철수 ', ['이영희'], 6000),
    game(at(2026, 10, 3), '이영희', ['김철수  ', '박민수'], 3000),
  ];
  const s = summarize(records);
  assert.equal(s.games, 3);
  assert.equal(s.totalPaid, 18000);
  assert.deepEqual(s.people.map((p) => [p.name, p.losses, p.games]), [
    ['김철수', 2, 3],
    ['이영희', 1, 3],
    ['박민수', 0, 2],
  ]);
  assert.equal(s.people[0].paid, 15000);
});

test('연속 기록: 최근부터 같은 결과가 몇 판 이어졌는지', () => {
  const t0 = at(2026, 10, 1);
  const records = [
    game(t0, 'A', ['B']),
    game(t0 + 1, 'B', ['A']),
    game(t0 + 2, 'B', ['A']),
    game(t0 + 3, 'B', ['A']),
  ];
  assert.deepEqual(currentStreak(personTimeline(records, 'B')), { kind: 'lose', count: 3 });
  assert.deepEqual(currentStreak(personTimeline(records, 'A')), { kind: 'survive', count: 3 });
  assert.equal(currentStreak(personTimeline(records, '없는사람')), null);
});

test('한마디: 3연속 당첨은 가장 먼저 소개된다', () => {
  const t0 = at(2026, 10, 1);
  const history = [game(t0, '철수', ['영희', '민수']), game(t0 + 1, '철수', ['영희', '민수'])];
  const current = game(t0 + 2, '철수', ['영희', '민수']);
  const lines = buildWittyLines(history, current, { random: first });
  assert.ok(lines[0].includes('3연속'), lines.join(' / '));
  assert.ok(lines.length <= 3);
});

test('한마디: 이번 판이 history에 이미 들어 있어도 두 번 세지 않는다', () => {
  const t0 = at(2026, 10, 1);
  const prev = game(t0, '철수', ['영희']);
  const current = game(t0 + 1, '철수', ['영희']);
  // 서버 저장 직후 구독 결과에 이번 판이 포함된 상황
  const lines = buildWittyLines([prev, current], current, { random: first });
  assert.ok(lines.some((l) => l.includes('2연속')), lines.join(' / '));
  assert.ok(!lines.some((l) => l.includes('3연속')));
});

test('한마디: 오래 살아남다 처음 걸리면 첫 당첨 소식', () => {
  const t0 = at(2026, 10, 1);
  const history = Array.from({ length: 5 }, (_, i) => game(t0 + i, '민수', ['영희']));
  const current = game(t0 + 10, '영희', ['민수']);
  const lines = buildWittyLines(history, current, { random: first });
  assert.ok(lines[0].includes('6판 만에 첫 당첨'), lines.join(' / '));
});

test('한마디: 연속 생존 기록이 끊기면 알려 준다', () => {
  const t0 = at(2026, 10, 1);
  const history = [
    game(t0, '영희', ['민수']),
    ...Array.from({ length: 6 }, (_, i) => game(t0 + 1 + i, '민수', ['영희'])),
  ];
  const current = game(t0 + 20, '영희', ['민수']);
  const lines = buildWittyLines(history, current, { random: first });
  assert.ok(lines.some((l) => l.includes('6연속 생존 기록')), lines.join(' / '));
});

test('한마디: 동점(공동 당첨)이면 공동 당첨 소식', () => {
  const current = game(at(2026, 10, 2), ['철수', '영희'], ['민수'], 5000);
  const lines = buildWittyLines([], current, { random: first });
  assert.ok(lines[0].includes('철수, 영희님 공동 당첨'), lines.join(' / '));
});

test('한마디: 이번 주 첫 판이면 지난주 커피왕을 소개한다', () => {
  const lastWeek = at(2026, 9, 24);
  const history = [
    game(lastWeek, '민수', ['영희', '철수']),
    game(lastWeek + 1, '민수', ['영희', '철수']),
    game(lastWeek + 2, '영희', ['민수', '철수']),
  ];
  const current = game(at(2026, 9, 29), '철수', ['영희', '민수']);
  const lines = buildWittyLines(history, current, { random: first });
  assert.ok(lines.some((l) => l.includes('지난주 커피왕은 민수님 (2회)')), lines.join(' / '));
});

test('한마디: 처음 하는 게임도 최소 한 줄은 나온다 & 같은 종류 소식은 한 번만', () => {
  const lines = buildWittyLines([], game(at(2026, 10, 4), '철수', ['영희']), { random: first });
  assert.ok(lines.length >= 1 && lines.length <= 3);
  assert.ok(lines.some((l) => l.includes('철수')));
  const many = Array.from({ length: 8 }, (_, i) => game(at(2026, 10, 1) + i, '철수', ['영희'], 9000));
  const rich = buildWittyLines(many.slice(0, -1), many[many.length - 1], { random: first, max: 10 });
  assert.ok(rich.length >= 3, rich.join(' / '));
  assert.equal(new Set(rich).size, rich.length, '중복 문구 없음');
  // 8연패 중인 사람에게는 '연속 당첨' 소식이 한 번만 나와야 함
  assert.equal(rich.filter((l) => l.includes('연속 당첨') || l.includes('연패')).length, 1, rich.join(' / '));
});

test('한마디: 첫 판에는 \'이번 달 누적\' 금액 소식을 띄우지 않는다', () => {
  const debut = buildWittyLines([], game(at(2026, 10, 4), '지민', ['철수'], 10000), { random: first });
  assert.ok(!debut.some((l) => l.includes('누적')), debut.join(' / '));
  const second = buildWittyLines(
    [game(at(2026, 10, 1), '지민', ['철수'], 10000), game(at(2026, 10, 2), '철수', ['지민'], 10000)],
    game(at(2026, 10, 4), '지민', ['철수'], 10000),
    { random: first, max: 10 }
  );
  assert.ok(second.some((l) => l.includes('누적 20,000원')), second.join(' / '));
});

test('결과 계산: 몰빵은 꼴찌, 랜덤 분배는 최고 금액 부담자가 걸린 사람', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const allIn = computeOutcome(players, ['b', 'c', 'a'], [0, 0, 15000]);
  assert.deepEqual(allIn.filter((o) => o.isLoser).map((o) => o.player.name), ['A']);
  const random = computeOutcome(players, ['b', 'c', 'a'], [7000, 5000, 3000]);
  assert.deepEqual(random.filter((o) => o.isLoser).map((o) => o.player.name), ['B']);
  const noAmount = computeOutcome(players, ['b', 'c', 'a'], [0, 0, 0]);
  assert.deepEqual(noAmount.filter((o) => o.isLoser).map((o) => o.player.name), ['A']);
  const tie = computeOutcome(players, ['b', 'c', 'a'], [5000, 5000, 0]);
  assert.deepEqual(tie.filter((o) => o.isLoser).map((o) => o.player.name), ['B', 'C']);
});
