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
}

export interface ReplayData {
  _id?: string;
  userId?: string;
  deviceId: string;
  players: Player[];
  amountsPool: number[];
  gameMode: GameMode;
  raceResults: string[];
  trajectory: string; // JSON.stringify(TrajectoryFrame[])
  createdAt?: number;
}
