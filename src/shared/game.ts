import type { ActionResult, GameAction, GameMode, GameState, Orientation, PlayerId, Position, Wall } from "./types";

export const BOARD_SIZE = 9;
export const WALL_GRID_SIZE = BOARD_SIZE - 1;
export const STARTING_WALLS = 10;

const DIRS: Position[] = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 }
];

export function createGame(mode: GameMode = "local"): GameState {
  const activePlayer: PlayerId = Math.random() < 0.5 ? "p1" : "p2";
  const now = new Date().toISOString();

  return {
    id: cryptoId(),
    mode,
    activePlayer,
    walls: [],
    status: "playing",
    winner: null,
    createdAt: now,
    updatedAt: now,
    players: {
      p1: {
        id: "p1",
        name: "Blue",
        position: { row: BOARD_SIZE - 1, col: Math.floor(BOARD_SIZE / 2) },
        wallsRemaining: STARTING_WALLS,
        goalRow: 0
      },
      p2: {
        id: "p2",
        name: "Gold",
        position: { row: 0, col: Math.floor(BOARD_SIZE / 2) },
        wallsRemaining: STARTING_WALLS,
        goalRow: BOARD_SIZE - 1
      }
    }
  };
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  if (state.status === "finished") {
    return reject(state, "The game is already finished.");
  }

  if (action.type === "move") {
    const legalMoves = getLegalMoves(state, state.activePlayer);
    if (!legalMoves.some((move) => samePos(move, action.to))) {
      return reject(state, "That pawn move is not legal.");
    }

    const next = cloneState(state);
    const player = next.players[next.activePlayer];
    player.position = { ...action.to };
    if (player.position.row === player.goalRow) {
      next.status = "finished";
      next.winner = player.id;
    } else {
      next.activePlayer = otherPlayer(next.activePlayer);
    }
    next.updatedAt = new Date().toISOString();
    return { ok: true, state: next };
  }

  const validation = validateWallPlacement(state, action.wall);
  if (!validation.ok) {
    return reject(state, validation.error);
  }

  const next = cloneState(state);
  next.walls.push({ ...action.wall });
  next.players[next.activePlayer].wallsRemaining -= 1;
  next.activePlayer = otherPlayer(next.activePlayer);
  next.updatedAt = new Date().toISOString();
  return { ok: true, state: next };
}

export function getLegalMoves(state: GameState, playerId: PlayerId): Position[] {
  const player = state.players[playerId];
  const opponent = state.players[otherPlayer(playerId)];
  const moves: Position[] = [];

  for (const dir of DIRS) {
    const adjacent = add(player.position, dir);
    if (!inBounds(adjacent) || isBlocked(player.position, adjacent, state.walls)) {
      continue;
    }

    if (!samePos(adjacent, opponent.position)) {
      moves.push(adjacent);
      continue;
    }

    const behind = add(opponent.position, dir);
    if (inBounds(behind) && !isBlocked(opponent.position, behind, state.walls)) {
      moves.push(behind);
      continue;
    }

    for (const sideDir of perpendicularDirs(dir)) {
      const side = add(opponent.position, sideDir);
      if (inBounds(side) && !isBlocked(opponent.position, side, state.walls)) {
        moves.push(side);
      }
    }
  }

  return uniquePositions(moves);
}

export function validateWallPlacement(state: GameState, wall: Wall): { ok: true } | { ok: false; error: string } {
  const player = state.players[state.activePlayer];

  if (player.wallsRemaining <= 0) {
    return { ok: false, error: "The active player has no walls remaining." };
  }

  if (!isValidWallCoordinate(wall)) {
    return { ok: false, error: "That wall is outside the valid wall grid." };
  }

  if (state.walls.some((existing) => sameWall(existing, wall))) {
    return { ok: false, error: "That wall overlaps an existing wall." };
  }

  if (state.walls.some((existing) => wallsCross(existing, wall))) {
    return { ok: false, error: "That wall crosses an existing wall." };
  }

  const walls = [...state.walls, wall];
  if (!hasPathToGoal(state.players.p1.position, state.players.p1.goalRow, walls)) {
    return { ok: false, error: "That wall blocks Blue from every goal path." };
  }

  if (!hasPathToGoal(state.players.p2.position, state.players.p2.goalRow, walls)) {
    return { ok: false, error: "That wall blocks Gold from every goal path." };
  }

  return { ok: true };
}

export function isBlocked(from: Position, to: Position, walls: Wall[]): boolean {
  if (manhattan(from, to) !== 1) {
    return true;
  }

  if (from.row !== to.row) {
    const topRow = Math.min(from.row, to.row);
    const col = from.col;
    return walls.some(
      (wall) => wall.orientation === "horizontal" && wall.row === topRow && (wall.col === col || wall.col === col - 1)
    );
  }

  const leftCol = Math.min(from.col, to.col);
  const row = from.row;
  return walls.some(
    (wall) => wall.orientation === "vertical" && wall.col === leftCol && (wall.row === row || wall.row === row - 1)
  );
}

export function isValidWallCoordinate(wall: Wall): boolean {
  return (
    (wall.orientation === "horizontal" || wall.orientation === "vertical") &&
    Number.isInteger(wall.row) &&
    Number.isInteger(wall.col) &&
    wall.row >= 0 &&
    wall.row < WALL_GRID_SIZE &&
    wall.col >= 0 &&
    wall.col < WALL_GRID_SIZE
  );
}

export function wallKey(wall: Wall): string {
  return `${wall.orientation}:${wall.row}:${wall.col}`;
}

export function positionKey(position: Position): string {
  return `${position.row}:${position.col}`;
}

export function samePos(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function reject(state: GameState, error: string): ActionResult {
  return { ok: false, state, error };
}

function hasPathToGoal(start: Position, goalRow: number, walls: Wall[]): boolean {
  const queue: Position[] = [start];
  const seen = new Set<string>([positionKey(start)]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (current.row === goalRow) {
      return true;
    }

    for (const dir of DIRS) {
      const next = add(current, dir);
      const key = positionKey(next);
      if (inBounds(next) && !seen.has(key) && !isBlocked(current, next, walls)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }

  return false;
}

function sameWall(a: Wall, b: Wall): boolean {
  return a.orientation === b.orientation && a.row === b.row && a.col === b.col;
}

function wallsCross(a: Wall, b: Wall): boolean {
  return a.orientation !== b.orientation && a.row === b.row && a.col === b.col;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    walls: state.walls.map((wall) => ({ ...wall })),
    players: {
      p1: { ...state.players.p1, position: { ...state.players.p1.position } },
      p2: { ...state.players.p2, position: { ...state.players.p2.position } }
    }
  };
}

function perpendicularDirs(dir: Position): Position[] {
  if (dir.row !== 0) {
    return [
      { row: 0, col: -1 },
      { row: 0, col: 1 }
    ];
  }

  return [
    { row: -1, col: 0 },
    { row: 1, col: 0 }
  ];
}

function uniquePositions(positions: Position[]): Position[] {
  const seen = new Set<string>();
  return positions.filter((position) => {
    const key = positionKey(position);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function add(a: Position, b: Position): Position {
  return { row: a.row + b.row, col: a.col + b.col };
}

function inBounds(position: Position): boolean {
  return position.row >= 0 && position.row < BOARD_SIZE && position.col >= 0 && position.col < BOARD_SIZE;
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function normalizeWall(input: unknown): Wall | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const wall = input as Partial<Wall>;
  if ((wall.orientation !== "horizontal" && wall.orientation !== "vertical") || typeof wall.row !== "number" || typeof wall.col !== "number") {
    return null;
  }

  return { orientation: wall.orientation as Orientation, row: wall.row, col: wall.col };
}

export function normalizePosition(input: unknown): Position | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const position = input as Partial<Position>;
  if (typeof position.row !== "number" || typeof position.col !== "number") {
    return null;
  }

  return { row: position.row, col: position.col };
}
