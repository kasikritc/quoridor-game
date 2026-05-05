export type PlayerId = "p1" | "p2";
export type Orientation = "horizontal" | "vertical";
export type GameMode = "local" | "bot";

export interface Position {
  row: number;
  col: number;
}

export interface Wall {
  row: number;
  col: number;
  orientation: Orientation;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  position: Position;
  wallsRemaining: number;
  goalRow: number;
}

export interface GameState {
  id: string;
  mode: GameMode;
  players: Record<PlayerId, PlayerState>;
  activePlayer: PlayerId;
  walls: Wall[];
  status: "playing" | "finished";
  winner: PlayerId | null;
  createdAt: string;
  updatedAt: string;
}

export type GameAction =
  | { type: "move"; to: Position }
  | { type: "wall"; wall: Wall };

export interface BotManifest {
  id: string;
  name: string;
  version: string;
  endpoint: string;
  description?: string;
}

export interface ActionResult {
  ok: boolean;
  state: GameState;
  error?: string;
}
