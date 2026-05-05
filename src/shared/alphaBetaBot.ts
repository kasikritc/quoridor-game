import { BOARD_SIZE, WALL_GRID_SIZE, applyAction, getLegalMoves, isBlocked, validateWallPlacement } from "./game";
import type { GameAction, GameState, PlayerId, Position, Wall } from "./types";

const DIRS: Position[] = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 }
];

const WIN_SCORE = 10_000;
const WALL_TEMPO_COST = 2;
const WALL_COUNT_WEIGHT = 0.25;
const GOAL_URGENCY_WEIGHT = 2;
const REPETITION_PENALTY = 25;
export const DEFAULT_TIME_BUDGET_MS = 5_000;

export interface AlphaBetaOptions {
  maxDepth?: number;
  timeBudgetMs?: number;
  wallStrategy?: "focused" | "all";
  trace?: AlphaBetaTraceSink;
}

type Bound = "exact" | "lower" | "upper";

export interface AlphaBetaTraceEvent {
  type: string;
  [key: string]: unknown;
}

export type AlphaBetaTraceSink = (event: AlphaBetaTraceEvent) => void;

interface TranspositionEntry {
  depth: number;
  score: number;
  bound: Bound;
  bestAction: GameAction | null;
}

interface SearchContext {
  deadlineMs: number;
  timedOut: boolean;
  transpositions: Map<string, TranspositionEntry>;
  pathLengths: Map<string, number | null>;
  pathRoutes: Map<string, Position[] | null>;
  wallStrategy: "focused" | "all";
  trace?: AlphaBetaTraceSink;
  nodesVisited: number;
}

interface SearchResult {
  action: GameAction | null;
  score: number;
  timedOut: boolean;
}

export function chooseAlphaBetaAction(state: GameState, options: AlphaBetaOptions = {}): GameAction | null {
  if (state.status !== "playing") {
    return null;
  }

  const resolved = resolveAlphaBetaOptions(options);
  const context = createSearchContext(resolved, options.trace);
  const fallback = orderActions(state, legalBotActions(state, { wallStrategy: resolved.wallStrategy }), context)[0] ?? null;
  let bestAction: GameAction | null = fallback;
  const maxDepth = resolved.maxDepth ?? Number.MAX_SAFE_INTEGER;

  trace(context, {
    type: "search_start",
    stateKey: stateKey(state),
    activePlayer: state.activePlayer,
    fallbackAction: fallback ? actionKey(fallback) : null,
    maxDepth: resolved.maxDepth ?? null,
    timeBudgetMs: resolved.timeBudgetMs,
    wallStrategy: resolved.wallStrategy
  });

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    if (isTimedOut(context)) {
      trace(context, { type: "search_timeout_before_depth", depth, bestAction: bestAction ? actionKey(bestAction) : null });
      break;
    }
    trace(context, { type: "iterative_depth_start", depth });
    const result = searchRoot(state, depth, context);
    if (result.timedOut) {
      trace(context, { type: "iterative_depth_incomplete", depth, bestAction: bestAction ? actionKey(bestAction) : null });
      break;
    }
    if (result.action) {
      bestAction = result.action;
    }
    trace(context, {
      type: "iterative_depth_complete",
      depth,
      score: result.score,
      bestAction: bestAction ? actionKey(bestAction) : null,
      nodesVisited: context.nodesVisited
    });
  }

  trace(context, {
    type: "search_complete",
    selectedAction: bestAction ? actionKey(bestAction) : null,
    timedOut: context.timedOut,
    nodesVisited: context.nodesVisited,
    transpositionEntries: context.transpositions.size,
    pathCacheEntries: context.pathLengths.size
  });

  return bestAction;
}

export function resolveAlphaBetaOptions(options: AlphaBetaOptions = {}): Required<Pick<AlphaBetaOptions, "timeBudgetMs" | "wallStrategy">> & { maxDepth?: number } {
  const timeBudgetMs = Number.isFinite(options.timeBudgetMs) ? Math.max(1, Math.floor(options.timeBudgetMs as number)) : DEFAULT_TIME_BUDGET_MS;
  const maxDepth = options.maxDepth === undefined ? undefined : Math.max(1, Math.floor(options.maxDepth));
  const wallStrategy = options.wallStrategy ?? "focused";

  return { maxDepth, timeBudgetMs, wallStrategy };
}

export function legalBotActions(state: GameState, options: Pick<AlphaBetaOptions, "wallStrategy"> = {}): GameAction[] {
  if (state.status !== "playing") {
    return [];
  }

  const pawnMoves = getLegalMoves(state, state.activePlayer).map((to): GameAction => ({ type: "move", to }));
  const player = state.players[state.activePlayer];

  if (player.wallsRemaining <= 0) {
    return pawnMoves;
  }

  const wallMoves = candidateWalls(state, options.wallStrategy ?? "focused")
    .filter((wall) => validateWallPlacement(state, wall).ok)
    .map((wall): GameAction => ({ type: "wall", wall }));

  return [...pawnMoves, ...wallMoves];
}

export function shortestPathLength(state: GameState, playerId: PlayerId): number | null {
  return shortestPath(state, playerId)?.length ?? null;
}

function cachedShortestPathLength(state: GameState, playerId: PlayerId, context: SearchContext): number | null {
  const key = `${stateKey(state)}|${playerId}`;
  if (context.pathLengths.has(key)) {
    trace(context, { type: "path_cache_hit", playerId, stateKey: stateKey(state), value: context.pathLengths.get(key) ?? null });
    return context.pathLengths.get(key) ?? null;
  }

  const value = shortestPathLength(state, playerId);
  context.pathLengths.set(key, value);
  trace(context, { type: "path_cache_store", playerId, stateKey: stateKey(state), value });
  return value;
}

function cachedShortestPath(state: GameState, playerId: PlayerId, context: SearchContext): Position[] | null {
  const key = `${stateKey(state)}|${playerId}`;
  if (context.pathRoutes.has(key)) {
    trace(context, { type: "path_route_cache_hit", playerId, stateKey: stateKey(state) });
    return context.pathRoutes.get(key) ?? null;
  }

  const value = shortestPath(state, playerId)?.route ?? null;
  context.pathRoutes.set(key, value);
  trace(context, { type: "path_route_cache_store", playerId, stateKey: stateKey(state), length: value ? value.length - 1 : null });
  return value;
}

function shortestPath(state: GameState, playerId: PlayerId): { length: number; route: Position[] } | null {
  const player = state.players[playerId];
  const queue: Array<{ position: Position; distance: number; route: Position[] }> = [{ position: player.position, distance: 0, route: [player.position] }];
  const seen = new Set<string>([pathKey(player.position)]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (current.position.row === player.goalRow) {
      return { length: current.distance, route: current.route };
    }

    for (const dir of DIRS) {
      const next = add(current.position, dir);
      const key = pathKey(next);
      if (inBounds(next) && !seen.has(key) && !isBlocked(current.position, next, state.walls)) {
        seen.add(key);
        queue.push({ position: next, distance: current.distance + 1, route: [...current.route, next] });
      }
    }
  }

  return null;
}

export function evaluateState(state: GameState, playerId: PlayerId): number {
  return evaluateStateWithContext(state, playerId);
}

function evaluateStateWithContext(state: GameState, playerId: PlayerId, context?: SearchContext): number {
  if (state.status === "finished") {
    const score = state.winner === playerId ? WIN_SCORE : -WIN_SCORE;
    if (context) {
      trace(context, { type: "evaluate_terminal", playerId, stateKey: stateKey(state), winner: state.winner, score });
    }
    return score;
  }

  const myDistance = context ? cachedShortestPathLength(state, playerId, context) : shortestPathLength(state, playerId);
  const opponentId = otherPlayer(playerId);
  const opponentDistance = context ? cachedShortestPathLength(state, opponentId, context) : shortestPathLength(state, opponentId);

  if (myDistance === null) {
    if (context) {
      trace(context, { type: "evaluate", playerId, stateKey: stateKey(state), myDistance, opponentDistance, score: -WIN_SCORE });
    }
    return -WIN_SCORE;
  }
  if (opponentDistance === null) {
    if (context) {
      trace(context, { type: "evaluate", playerId, stateKey: stateKey(state), myDistance, opponentDistance, score: WIN_SCORE });
    }
    return WIN_SCORE;
  }

  const score =
    opponentDistance -
    myDistance +
    (goalUrgency(myDistance) - goalUrgency(opponentDistance)) * GOAL_URGENCY_WEIGHT +
    (state.players[playerId].wallsRemaining - state.players[opponentId].wallsRemaining) * WALL_COUNT_WEIGHT;

  if (context) {
    trace(context, { type: "evaluate", playerId, stateKey: stateKey(state), myDistance, opponentDistance, score });
  }

  return score;
}

function goalUrgency(distance: number): number {
  return Math.max(0, 3 - distance);
}

function searchRoot(state: GameState, depth: number, context: SearchContext): SearchResult {
  context.nodesVisited += 1;
  let bestAction: GameAction | null = null;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  const actions = orderActions(state, legalBotActions(state, { wallStrategy: context.wallStrategy }), context);

  trace(context, {
    type: "root_node_enter",
    depth,
    stateKey: stateKey(state),
    actionCount: actions.length,
    actions: actions.map(actionKey),
    alpha,
    beta
  });

  for (const action of actions) {
    if (isTimedOut(context)) {
      trace(context, { type: "root_timeout", depth, stateKey: stateKey(state), action: actionKey(action), bestScore });
      return { action: null, score: bestScore, timedOut: true };
    }

    const child = applyAction(state, action);
    if (!child.ok) {
      trace(context, { type: "root_action_rejected", depth, stateKey: stateKey(state), action: actionKey(action), error: child.error });
      continue;
    }

    trace(context, { type: "root_action_explore", depth, stateKey: stateKey(state), action: actionKey(action), alpha, beta });
    const line = new Set<string>([stateKey(state), stateKey(child.state)]);
    const childResult = negamax(child.state, depth - 1, -beta, -alpha, context, 1, line);
    if (childResult.timedOut) {
      return { action: null, score: bestScore, timedOut: true };
    }

    const score = -childResult.score;
    trace(context, { type: "root_action_score", depth, stateKey: stateKey(state), action: actionKey(action), score });
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
      trace(context, { type: "root_best_update", depth, stateKey: stateKey(state), action: actionKey(action), score });
    }
    alpha = Math.max(alpha, score);
  }

  context.transpositions.set(stateKey(state), { depth, score: bestScore, bound: "exact", bestAction });
  trace(context, { type: "transposition_store", depth, stateKey: stateKey(state), score: bestScore, bound: "exact", bestAction: bestAction ? actionKey(bestAction) : null });
  return { action: bestAction, score: bestScore, timedOut: false };
}

function negamax(state: GameState, depth: number, alpha: number, beta: number, context: SearchContext, plyFromRoot: number, line: Set<string>): SearchResult {
  context.nodesVisited += 1;
  trace(context, { type: "node_enter", depth, stateKey: stateKey(state), activePlayer: state.activePlayer, alpha, beta });
  if (isTimedOut(context)) {
    trace(context, { type: "node_timeout", depth, stateKey: stateKey(state) });
    return { action: null, score: 0, timedOut: true };
  }

  if (state.status === "finished") {
    const score = state.winner === state.activePlayer ? -WIN_SCORE + plyFromRoot : WIN_SCORE - plyFromRoot;
    trace(context, { type: "node_leaf", depth, stateKey: stateKey(state), score });
    return { action: null, score, timedOut: false };
  }

  if (depth === 0) {
    const score = evaluateStateWithContext(state, state.activePlayer, context);
    trace(context, { type: "node_leaf", depth, stateKey: stateKey(state), score });
    return { action: null, score, timedOut: false };
  }

  const originalAlpha = alpha;
  const key = stateKey(state);
  const cached = context.transpositions.get(key);
  if (cached && cached.depth >= depth) {
    trace(context, { type: "transposition_hit", depth, stateKey: key, cachedDepth: cached.depth, score: cached.score, bound: cached.bound, bestAction: cached.bestAction ? actionKey(cached.bestAction) : null });
    if (cached.bound === "exact") {
      return { action: cached.bestAction, score: cached.score, timedOut: false };
    }
    if (cached.bound === "lower") {
      alpha = Math.max(alpha, cached.score);
    } else if (cached.bound === "upper") {
      beta = Math.min(beta, cached.score);
    }
    if (alpha >= beta) {
      return { action: cached.bestAction, score: cached.score, timedOut: false };
    }
  }

  let best = -Infinity;
  let bestAction: GameAction | null = null;
  const actions = orderActions(state, legalBotActions(state, { wallStrategy: context.wallStrategy }), context, cached?.bestAction ?? null);
  trace(context, { type: "node_actions", depth, stateKey: key, actionCount: actions.length, actions: actions.map(actionKey) });

  for (const action of actions) {
    if (isTimedOut(context)) {
      trace(context, { type: "node_timeout", depth, stateKey: key, action: actionKey(action), bestScore: best });
      return { action: null, score: best, timedOut: true };
    }

    const child = applyAction(state, action);
    if (!child.ok) {
      trace(context, { type: "node_action_rejected", depth, stateKey: key, action: actionKey(action), error: child.error });
      continue;
    }

    trace(context, { type: "node_action_explore", depth, stateKey: key, action: actionKey(action), alpha, beta });
    const childKey = stateKey(child.state);
    const childResult = line.has(childKey) ? { action: null, score: REPETITION_PENALTY, timedOut: false } : withLineState(line, childKey, () => negamax(child.state, depth - 1, -beta, -alpha, context, plyFromRoot + 1, line));
    if (line.has(childKey)) {
      trace(context, { type: "node_repetition_penalty", depth, stateKey: key, action: actionKey(action), childStateKey: childKey, score: REPETITION_PENALTY });
    }
    if (childResult.timedOut) {
      return { action: null, score: best, timedOut: true };
    }

    const score = -childResult.score;
    trace(context, { type: "node_action_score", depth, stateKey: key, action: actionKey(action), score });
    if (score > best) {
      best = score;
      bestAction = action;
      trace(context, { type: "node_best_update", depth, stateKey: key, action: actionKey(action), score });
    }
    alpha = Math.max(alpha, score);
    trace(context, { type: "alpha_update", depth, stateKey: key, alpha, beta, action: actionKey(action) });

    if (alpha >= beta) {
      trace(context, { type: "alpha_beta_prune", depth, stateKey: key, alpha, beta, action: actionKey(action) });
      break;
    }
  }

  const bound: Bound = best <= originalAlpha ? "upper" : best >= beta ? "lower" : "exact";
  context.transpositions.set(key, { depth, score: best, bound, bestAction });
  trace(context, { type: "transposition_store", depth, stateKey: key, score: best, bound, bestAction: bestAction ? actionKey(bestAction) : null });
  return { action: bestAction, score: best, timedOut: false };
}

function orderActions(state: GameState, actions: GameAction[], context: SearchContext, preferredAction: GameAction | null = null): GameAction[] {
  const ordered = actions
    .map((action) => ({ action, priority: actionPriority(state, action, context, preferredAction) }))
    .sort((a, b) => b.priority - a.priority || actionKey(a.action).localeCompare(actionKey(b.action)));
  trace(context, {
    type: "action_order",
    stateKey: stateKey(state),
    preferredAction: preferredAction ? actionKey(preferredAction) : null,
    actions: ordered.map((entry) => ({ action: actionKey(entry.action), priority: entry.priority }))
  });
  return ordered.map((entry) => entry.action);
}

function actionPriority(state: GameState, action: GameAction, context: SearchContext, preferredAction: GameAction | null): number {
  if (preferredAction && actionKey(action) === actionKey(preferredAction)) {
    return 2_000;
  }

  const result = applyAction(state, action);
  if (!result.ok) {
    return -Infinity;
  }

  if (result.state.status === "finished" && result.state.winner === state.activePlayer) {
    return 1_000;
  }

  if (action.type === "move") {
    const before = cachedShortestPathLength(state, state.activePlayer, context) ?? BOARD_SIZE * BOARD_SIZE;
    const after = cachedShortestPathLength(result.state, state.activePlayer, context) ?? BOARD_SIZE * BOARD_SIZE;
    return 100 + (before - after);
  }

  const opponentId = otherPlayer(state.activePlayer);
  const before = cachedShortestPathLength(state, opponentId, context) ?? 0;
  const after = cachedShortestPathLength(result.state, opponentId, context) ?? 0;
  const myBefore = cachedShortestPathLength(state, state.activePlayer, context) ?? BOARD_SIZE * BOARD_SIZE;
  const myAfter = cachedShortestPathLength(result.state, state.activePlayer, context) ?? BOARD_SIZE * BOARD_SIZE;
  const opponentDelay = after - before;
  const selfDelay = myAfter - myBefore;
  const urgentBlockBonus = before <= 2 && opponentDelay > 0 ? 20 : 0;
  return 10 + urgentBlockBonus + opponentDelay * 3 - selfDelay * 2 - WALL_TEMPO_COST;
}

function withLineState<T>(line: Set<string>, key: string, run: () => T): T {
  line.add(key);
  try {
    return run();
  } finally {
    line.delete(key);
  }
}

function createSearchContext(options: ReturnType<typeof resolveAlphaBetaOptions>, traceSink?: AlphaBetaTraceSink): SearchContext {
  return {
    deadlineMs: Date.now() + options.timeBudgetMs,
    timedOut: false,
    transpositions: new Map(),
    pathLengths: new Map(),
    pathRoutes: new Map(),
    wallStrategy: options.wallStrategy,
    trace: traceSink,
    nodesVisited: 0
  };
}

function isTimedOut(context: SearchContext): boolean {
  if (context.timedOut) {
    return true;
  }

  context.timedOut = Date.now() >= context.deadlineMs;
  if (context.timedOut) {
    trace(context, { type: "deadline_reached", deadlineMs: context.deadlineMs });
  }
  return context.timedOut;
}

function candidateWalls(state: GameState, strategy: "focused" | "all"): Wall[] {
  if (strategy === "all") {
    return allWalls();
  }

  const walls = new Map<string, Wall>();
  const context = createSearchContext({ timeBudgetMs: DEFAULT_TIME_BUDGET_MS, wallStrategy: "focused" });
  for (const playerId of ["p1", "p2"] as const) {
    for (const wall of wallsAroundRoute(cachedShortestPath(state, playerId, context) ?? [])) {
      walls.set(wallKey(wall), wall);
    }
    for (const wall of wallsAroundPosition(state.players[playerId].position, 2)) {
      walls.set(wallKey(wall), wall);
    }
  }

  return [...walls.values()].sort(compareWalls);
}

function trace(context: SearchContext, event: AlphaBetaTraceEvent): void {
  if (!context.trace) {
    return;
  }

  context.trace(event);
}

function allWalls(): Wall[] {
  const walls: Wall[] = [];
  for (let row = 0; row < WALL_GRID_SIZE; row += 1) {
    for (let col = 0; col < WALL_GRID_SIZE; col += 1) {
      walls.push({ row, col, orientation: "horizontal" }, { row, col, orientation: "vertical" });
    }
  }
  return walls;
}

function wallsAroundRoute(route: Position[]): Wall[] {
  const walls: Wall[] = [];
  for (let index = 1; index < route.length; index += 1) {
    for (const wall of wallsBlockingEdge(route[index - 1], route[index])) {
      walls.push(wall, ...neighborWalls(wall));
    }
  }
  return walls;
}

function wallsBlockingEdge(a: Position, b: Position): Wall[] {
  const walls: Wall[] = [];
  if (a.row !== b.row) {
    const row = Math.min(a.row, b.row);
    for (const col of [a.col - 1, a.col]) {
      if (isValidWallAnchor(row, col)) {
        walls.push({ row, col, orientation: "horizontal" });
      }
    }
    return walls;
  }

  const col = Math.min(a.col, b.col);
  for (const row of [a.row - 1, a.row]) {
    if (isValidWallAnchor(row, col)) {
      walls.push({ row, col, orientation: "vertical" });
    }
  }
  return walls;
}

function wallsAroundPosition(position: Position, radius: number): Wall[] {
  const walls: Wall[] = [];
  for (let row = position.row - radius; row <= position.row + radius; row += 1) {
    for (let col = position.col - radius; col <= position.col + radius; col += 1) {
      if (isValidWallAnchor(row, col)) {
        walls.push({ row, col, orientation: "horizontal" }, { row, col, orientation: "vertical" });
      }
    }
  }
  return walls;
}

function neighborWalls(wall: Wall): Wall[] {
  const walls: Wall[] = [];
  const offsets = wall.orientation === "horizontal" ? [{ row: 0, col: -1 }, { row: 0, col: 1 }] : [{ row: -1, col: 0 }, { row: 1, col: 0 }];
  for (const offset of offsets) {
    const row = wall.row + offset.row;
    const col = wall.col + offset.col;
    if (isValidWallAnchor(row, col)) {
      walls.push({ row, col, orientation: wall.orientation });
    }
  }
  return walls;
}

function compareWalls(a: Wall, b: Wall): number {
  if (a.row !== b.row) {
    return a.row - b.row;
  }
  if (a.col !== b.col) {
    return a.col - b.col;
  }
  return a.orientation.localeCompare(b.orientation);
}

function isValidWallAnchor(row: number, col: number): boolean {
  return row >= 0 && row < WALL_GRID_SIZE && col >= 0 && col < WALL_GRID_SIZE;
}

function stateKey(state: GameState): string {
  return [
    state.activePlayer,
    `${state.players.p1.position.row}:${state.players.p1.position.col}`,
    `${state.players.p2.position.row}:${state.players.p2.position.col}`,
    state.players.p1.wallsRemaining,
    state.players.p2.wallsRemaining,
    [...state.walls].sort(compareWalls).map(wallKey).join(","),
    state.status,
    state.winner ?? ""
  ].join("|");
}

function actionKey(action: GameAction): string {
  if (action.type === "move") {
    return `move:${pathKey(action.to)}`;
  }
  return `wall:${wallKey(action.wall)}`;
}

function wallKey(wall: Wall): string {
  return `${wall.orientation}:${wall.row}:${wall.col}`;
}

function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}

function pathKey(position: Position): string {
  return `${position.row}:${position.col}`;
}

function add(a: Position, b: Position): Position {
  return { row: a.row + b.row, col: a.col + b.col };
}

function inBounds(position: Position): boolean {
  return position.row >= 0 && position.row < BOARD_SIZE && position.col >= 0 && position.col < BOARD_SIZE;
}
