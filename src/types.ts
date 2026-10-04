export type GameMode = 'all-in' | 'random';

export interface Player {
  id: string;
  name: string;
}

export type GameState = 'setup' | 'race' | 'result' | 'replay';

export interface Position2D {
  x: number;
  y: number;
}

export interface TrajectoryFrame {
  t: number; // 경과 시간(ms)
  positions: {
    [playerId: string]: Position2D;
  };
  // [하단 스피너, 중간 스피너] 각도(rad). 슬로우모션 중 회전이 느려지므로 시간으로 역산하지 않고 기록한다
  // (구버전 궤적에는 없음 → 재생 시 경과 시간으로 추정)
  spin?: [number, number];
}

export interface ReplayData {
  _id?: string;
  userId?: string;
  deviceId: string;
  players: Player[];
  amountsPool: number[];
  gameMode: GameMode;
  raceResults: string[];
  videoStorageId?: string; // 녹화 영상 스토리지 ID (신규 방식)
  videoUrl?: string | null; // getReplay가 해석해 반환하는 재생용 URL
  trajectory?: string; // JSON.stringify(TrajectoryFrame[]) — 폴백/구버전 호환
  createdAt?: number;
}
