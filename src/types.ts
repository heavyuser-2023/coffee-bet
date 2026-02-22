export type GameMode = 'all-in' | 'random';

export interface Player {
  id: string;
  name: string;
}

export type GameState = 'setup' | 'race' | 'result';
