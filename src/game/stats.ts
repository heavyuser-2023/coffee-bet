// 게임 기록(누가 걸렸는지)으로 주간/월간 통계와 결과 화면의 '재치 있는 한마디'를 만드는 순수 함수 모음.
// 참가자는 매 게임 새 ID가 발급되므로 이름(공백 정리)으로 같은 사람을 식별한다.

export interface RecordResult {
  name: string;
  rank: number;
  amount: number;
  isLoser: boolean;
}

export interface GameRecord {
  _id?: string;
  clientGameId: string;
  createdAt: number;
  gameMode: string;
  results: RecordResult[];
}

export const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');

const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const AMERICANO_PRICE = 4500;

// ------------------ 기간 ------------------

export type PeriodKind = 'week' | 'month' | 'all';

export interface Period {
  kind: PeriodKind;
  offset: number; // 0 = 이번 주/달, -1 = 지난주/달 ...
  start: number; // 포함
  end: number; // 미포함
  title: string;
  subtitle: string;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const formatMonthDay = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;

/** 기기 현지 시간 기준 그 주 월요일 00:00 */
export function startOfWeek(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function getPeriod(kind: PeriodKind, offset: number, now: number): Period {
  if (kind === 'week') {
    const start = startOfWeek(now);
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const lastDay = new Date(end);
    lastDay.setDate(lastDay.getDate() - 1);
    const title = offset === 0 ? '이번 주' : offset === -1 ? '지난주' : `${-offset}주 전`;
    return { kind, offset, start: start.getTime(), end: end.getTime(), title, subtitle: `${formatMonthDay(start)} – ${formatMonthDay(lastDay)}` };
  }
  if (kind === 'month') {
    const base = new Date(now);
    const start = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const end = new Date(base.getFullYear(), base.getMonth() + offset + 1, 1);
    const label = `${start.getFullYear()}년 ${start.getMonth() + 1}월`;
    const title = offset === 0 ? '이번 달' : offset === -1 ? '지난달' : label;
    return { kind, offset, start: start.getTime(), end: end.getTime(), title, subtitle: label };
  }
  return { kind, offset: 0, start: 0, end: Number.POSITIVE_INFINITY, title: '전체 기간', subtitle: '' };
}

export const inPeriod = (record: GameRecord, period: Period) =>
  record.createdAt >= period.start && record.createdAt < period.end;

// ------------------ 집계 ------------------

export interface PersonStat {
  name: string;
  games: number; // 참여한 게임 수
  losses: number; // 걸린 횟수
  paid: number; // 낸 금액 합계
  lossRate: number; // losses / games
}

export interface Summary {
  games: number;
  totalPaid: number;
  people: PersonStat[]; // 많이 걸린 순
}

export function summarize(records: GameRecord[]): Summary {
  const byName = new Map<string, PersonStat>();
  let totalPaid = 0;
  for (const record of records) {
    for (const r of record.results) {
      const name = normalizeName(r.name);
      const stat = byName.get(name) ?? { name, games: 0, losses: 0, paid: 0, lossRate: 0 };
      stat.games++;
      if (r.isLoser) stat.losses++;
      stat.paid += r.amount;
      totalPaid += r.amount;
      byName.set(name, stat);
    }
  }
  const people = [...byName.values()].map((s) => ({ ...s, lossRate: s.games > 0 ? s.losses / s.games : 0 }));
  people.sort(
    (a, b) =>
      b.losses - a.losses ||
      b.lossRate - a.lossRate ||
      b.paid - a.paid ||
      a.name.localeCompare(b.name, 'ko')
  );
  return { games: records.length, totalPaid, people };
}

export interface PersonGame {
  clientGameId: string;
  createdAt: number;
  isLoser: boolean;
  amount: number;
  rank: number;
  playerCount: number;
}

/** 한 사람이 참여한 게임만 시간순(오래된 → 최신)으로 */
export function personTimeline(records: GameRecord[], name: string): PersonGame[] {
  const key = normalizeName(name);
  return records
    .flatMap((record) => {
      const r = record.results.find((x) => normalizeName(x.name) === key);
      if (!r) return [];
      return [{
        clientGameId: record.clientGameId,
        createdAt: record.createdAt,
        isLoser: r.isLoser,
        amount: r.amount,
        rank: r.rank,
        playerCount: record.results.length,
      }];
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

export interface Streak {
  kind: 'lose' | 'survive';
  count: number;
}

/** 가장 최근 게임부터 거슬러 올라가며 같은 결과(당첨/생존)가 몇 판 연속인지 */
export function currentStreak(timeline: PersonGame[]): Streak | null {
  if (timeline.length === 0) return null;
  const last = timeline[timeline.length - 1].isLoser;
  let count = 0;
  for (let i = timeline.length - 1; i >= 0 && timeline[i].isLoser === last; i--) count++;
  return { kind: last ? 'lose' : 'survive', count };
}

// ------------------ 결과 화면의 재치 있는 한마디 ------------------

interface Candidate {
  score: number; // 높을수록 흥미로운 소식 → 먼저 노출
  category: string; // 같은 종류 소식은 하나만
  text: string;
}

export interface WittyOptions {
  random?: () => number; // 문구 템플릿 선택용 (테스트에서 고정)
  max?: number; // 최대 줄 수
}

/**
 * 이번 판(current)과 이전 기록(history)을 바탕으로 결과 화면에 띄울 통계 한마디를 만든다.
 * history에 current가 이미 포함돼 있어도(clientGameId 기준) 한 번만 센다.
 */
export function buildWittyLines(history: GameRecord[], current: GameRecord, options: WittyOptions = {}): string[] {
  const random = options.random ?? Math.random;
  const max = options.max ?? 3;
  const pick = (templates: string[]) => templates[Math.floor(random() * templates.length) % templates.length];

  const all = [...history.filter((r) => r.clientGameId !== current.clientGameId), current]
    .sort((a, b) => a.createdAt - b.createdAt);
  const now = current.createdAt;
  const week = getPeriod('week', 0, now);
  const lastWeek = getPeriod('week', -1, now);
  const month = getPeriod('month', 0, now);
  const weekRecords = all.filter((r) => inPeriod(r, week));
  const monthRecords = all.filter((r) => inPeriod(r, month));
  const weekSummary = summarize(weekRecords);

  const losers = current.results.filter((r) => r.isLoser).map((r) => normalizeName(r.name));
  const candidates: Candidate[] = [];
  const add = (score: number, category: string, text: string) => candidates.push({ score, category, text });

  if (losers.length >= 2) {
    const names = losers.join(', ');
    add(95, 'tie', pick([
      `🤝 ${names}님 공동 당첨! 사이좋게 나눠 내세요`,
      `🤝 ${names}님 나란히 당첨! 오늘의 커피 공동 후원자`,
    ]));
  }

  for (const L of losers.slice(0, 2)) {
    const timeline = personTimeline(all, L);
    const streak = currentStreak(timeline);
    const totalLosses = timeline.filter((g) => g.isLoser).length;
    const totalGames = timeline.length;

    // 이번 연속 당첨 직전까지 몇 판 연속 살아남았었는지
    let prevSurvive = 0;
    for (let i = timeline.length - 1 - (streak?.count ?? 0); i >= 0 && !timeline[i].isLoser; i--) prevSurvive++;

    const weekLosses = timeline.filter((g) => g.isLoser && g.createdAt >= week.start && g.createdAt < week.end).length;
    const monthGames = timeline.filter((g) => g.createdAt >= month.start && g.createdAt < month.end);
    const monthLosses = monthGames.filter((g) => g.isLoser).length;
    const monthPaid = monthGames.reduce((sum, g) => sum + g.amount, 0);

    if (streak && streak.kind === 'lose' && streak.count >= 3) {
      add(100, 'streak', pick([
        `🔥 ${L}님 ${streak.count}연속 당첨! 이쯤 되면 실력입니다`,
        `🔥 ${streak.count}연패… 오늘 ${L}님 지갑은 쉬는 날이 없네요`,
        `🔥 ${L}님 ${streak.count}연속 당첨! 바리스타가 단골 등록하셨대요`,
      ]));
    } else if (streak && streak.kind === 'lose' && streak.count === 2) {
      add(80, 'streak', pick([
        `😮 ${L}님 2연속 당첨! 데자뷔 아니고 실화입니다`,
        `😮 방금 그분 또 걸렸어요… ${L}님 2연속!`,
      ]));
    }

    if (totalLosses === 1) {
      if (totalGames >= 3) {
        add(90, 'first', pick([
          `🎉 ${L}님 ${totalGames}판 만에 첫 당첨! 축하… 드려도 되죠?`,
          `🎊 무패 신화 종료! ${L}님 ${totalGames}판 만에 첫 커피 당첨`,
        ]));
      } else {
        add(40, 'first', `☕ ${L}님 커피 기록 데뷔! 첫 당첨을 축하합니다`);
      }
    } else if (prevSurvive >= 5) {
      add(85, 'survival-end', pick([
        `💥 ${L}님의 ${prevSurvive}연속 생존 기록, 여기서 막을 내립니다`,
        `💥 ${prevSurvive}판 무사통과하던 ${L}님, 드디어 걸렸습니다`,
      ]));
    }

    if (weekLosses >= 2) {
      const top = weekSummary.people[0];
      const isSoleKing = top && top.name === L && (weekSummary.people[1]?.losses ?? 0) < top.losses;
      if (isSoleKing && weekLosses >= 3) {
        add(75, 'week', `👑 이번 주 커피왕 ${L}님 (${weekLosses}회) — 독주 체제 굳히기 들어갑니다`);
      } else {
        add(70, 'week', pick([
          `☕ ${L}님, 이번 주에만 벌써 ${weekLosses}번째! 카페 사장님이 이름 외우시겠어요`,
          `📅 이번 주 ${L}님 당첨 ${weekLosses}회째. 주간 커피 요정 유력 후보!`,
        ]));
      }
    }

    if (monthLosses >= 3 && monthLosses > weekLosses) {
      add(60, 'month', `🗓️ 이번 달 ${L}님 당첨 ${monthLosses}회 — 월간 커피 후원자 등극 각`);
    }

    // '누적' 소식이므로 이번 달 두 번 이상 낸 경우에만
    if (monthLosses >= 2 && monthPaid >= AMERICANO_PRICE * 2) {
      const cups = Math.floor(monthPaid / AMERICANO_PRICE);
      add(55, 'money', pick([
        `💸 ${L}님 이번 달 누적 ${formatWon(monthPaid)} — 아메리카노 약 ${cups}잔 분량`,
        `💸 ${L}님이 이번 달 커피에 쓴 돈 ${formatWon(monthPaid)}. 커피값 지분율 상승 중`,
      ]));
    }

    if (totalGames >= 5) {
      const expected = timeline.reduce((sum, g) => sum + 1 / g.playerCount, 0) / totalGames;
      const rate = totalLosses / totalGames;
      if (rate >= expected * 1.5) {
        add(50, 'rate', `📊 ${L}님 통산 당첨률 ${Math.round(rate * 100)}% — 확률상 기대치(${Math.round(expected * 100)}%)의 ${(rate / expected).toFixed(1)}배`);
      }
    }
  }

  // 살아남은 사람 중 최장 연속 생존자
  let lucky: { name: string; count: number } | null = null;
  for (const r of current.results) {
    if (r.isLoser) continue;
    const name = normalizeName(r.name);
    const streak = currentStreak(personTimeline(all, name));
    if (streak?.kind === 'survive' && streak.count >= 5 && (!lucky || streak.count > lucky.count)) {
      lucky = { name, count: streak.count };
    }
  }
  if (lucky) {
    add(50, 'lucky', pick([
      `🍀 ${lucky.name}님은 ${lucky.count}판 연속 생존 중. 비결 좀 공유해 주세요`,
      `🍀 ${lucky.name}님 ${lucky.count}연속 무사통과… 혹시 구슬에 뭐 바르셨어요?`,
    ]));
  }

  const isFirstGameOfWeek = weekRecords.length === 1;
  if (isFirstGameOfWeek) {
    const lastWeekSummary = summarize(all.filter((r) => inPeriod(r, lastWeek)));
    const king = lastWeekSummary.people[0];
    if (king && king.losses > 0) {
      add(65, 'new-week', `📅 새로운 한 주의 첫 판! 지난주 커피왕은 ${king.name}님 (${king.losses}회)`);
    }
  } else {
    // 이번 주 최다 당첨자가 이번 판 당첨자가 아니면 근황 소개
    const top = weekSummary.people[0];
    if (top && top.losses >= 2 && !losers.includes(top.name)) {
      const coKings = weekSummary.people.filter((p) => p.losses === top.losses).map((p) => p.name);
      add(45, 'king', coKings.length > 1
        ? `👑 이번 주 커피 요정 공동 1위: ${coKings.join(', ')}님 (각 ${top.losses}회)`
        : `👑 이번 주 커피 요정은 여전히 ${top.name}님 (${top.losses}회)`);
    }
  }

  add(20, 'count', `📈 이번 주 ${weekRecords.length}번째 · 이번 달 ${monthRecords.length}번째 게임`);

  if (losers.length === 1) {
    const L = losers[0];
    add(10, 'fallback', pick([
      `☕ 오늘 커피는 ${L}님이 쏩니다! 잘 마시겠습니다 🙏`,
      `☕ ${L}님의 넓은 마음(과 지갑)에 경의를 표합니다`,
      `🎯 오늘의 당첨자: ${L}님. 다들 박수!`,
    ]));
  }

  const lines: string[] = [];
  const usedCategories = new Set<string>();
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (lines.length >= max) break;
    if (usedCategories.has(c.category)) continue;
    usedCategories.add(c.category);
    lines.push(c.text);
  }
  return lines;
}
