import type { Player } from '../types';

export interface PlayerOutcome {
  player: Player;
  rank: number; // 레이스 도착 순위 (1부터)
  amount: number; // 이 사람이 낼 금액
  isLoser: boolean; // 이번 판에 '걸린' 사람
}

/**
 * 레이스 도착 순서(raceResults)와 순위별 금액(amountsPool)으로 각자의 결과를 계산한다.
 * - 금액이 지정된 경우: 가장 큰 금액을 부담하는 사람(들)이 걸린 사람 (랜덤 분배에서 전원이 걸리는 것 방지)
 * - 금액이 지정되지 않은 경우: 레이스의 최하위(마지막 도착)가 걸린 사람
 */
export function computeOutcome(players: Player[], raceResults: string[], amountsPool: number[]): PlayerOutcome[] {
  const totalBill = amountsPool.reduce((a, b) => a + b, 0);
  const hasAmount = totalBill > 0;
  const maxAmount = Math.max(...amountsPool, 0);

  return raceResults.flatMap((id, index) => {
    const player = players.find((p) => p.id === id);
    if (!player) return [];
    const amount = amountsPool[index] || 0;
    const isLoser = hasAmount ? amount > 0 && amount === maxAmount : index === raceResults.length - 1;
    return [{ player, rank: index + 1, amount, isLoser }];
  });
}
