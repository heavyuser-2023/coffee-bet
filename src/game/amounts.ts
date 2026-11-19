/**
 * 가중치 기반으로 총액을 100원 단위로 나눈 금액 풀을 1회 생성한다.
 * 남은 금액을 넘지 않게 클램핑하므로 마지막 몫이 음수가 되지 않는다.
 */
function rollOnce(playerCount: number, totalAmount: number): number[] {
  const weights = Array.from({ length: playerCount }, () => Math.random() + 0.1);
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const amounts: number[] = [];
  let remaining = totalAmount;
  for (let i = 0; i < playerCount - 1; i++) {
    const rawAmount = (weights[i] / weightSum) * totalAmount;
    const amount = Math.min(Math.round(rawAmount / 100) * 100, remaining);
    amounts.push(amount);
    remaining -= amount;
  }
  amounts.push(remaining);

  amounts.sort((a, b) => b - a);
  return amounts;
}

/**
 * 랜덤 분배 모드용 순위별 결제 금액 풀 생성.
 * - playerCount <= 0이면 빈 배열 반환
 * - totalAmount <= 0이면 전원 0원 배열 반환
 * - 직전 풀(previous)과 동일하면 최대 9회 재시도하여 다른 결과를 반환
 */
export function rollRandomAmounts(
  playerCount: number,
  totalAmount: number,
  previous?: number[],
): number[] {
  if (playerCount <= 0) return [];
  if (totalAmount <= 0) {
    return Array.from({ length: playerCount }, () => 0);
  }

  let amounts = rollOnce(playerCount, totalAmount);
  if (previous && previous.length === playerCount) {
    const prevKey = previous.join();
    for (let attempt = 0; attempt < 9 && amounts.join() === prevKey; attempt++) {
      amounts = rollOnce(playerCount, totalAmount);
    }
  }
  return amounts;
}
