import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TIME_BUDGET_MS, chooseAlphaBetaAction, resolveAlphaBetaOptions } from "../src/shared/alphaBetaBot";
import { applyAction, createGame, getLegalMoves, normalizePosition, normalizeWall } from "../src/shared/game";
import type { BotManifest, GameAction, GameMode, GameState } from "../src/shared/types";
import { LocalLogger } from "./localLogger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const botsDir = path.join(rootDir, "bots");
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT ?? 8787);
const defaultAlphaBetaTimeBudgetMs = parsePositiveInteger(process.env.ALPHA_BETA_TIME_BUDGET_MS) ?? DEFAULT_TIME_BUDGET_MS;
const logger = new LocalLogger({ rootDir: process.env.QUORIDOR_LOG_DIR ?? path.join(rootDir, "logs") });

const app = express();
const games = new Map<string, GameState>();
const turnCounts = new Map<string, number>();

app.use(express.json());

app.get("/api/bots", async (_req, res) => {
  const bots = await discoverBots();
  res.json({ bots });
});

app.post("/api/bots/alpha-beta/action", (req, res) => {
  const game = normalizeGameState(req.body?.state);
  if (!game) {
    res.status(400).json({ error: "Invalid bot state payload." });
    return;
  }

  const options = resolveAlphaBetaRequestOptions(req.body);
  const searchLogName = searchLogNameFor(game.id, nextTurnNumber(game.id));
  logger.game(game.id, { type: "standalone_bot_action_requested", botId: "alpha-beta", options, searchLog: searchLogName, state: summarizeState(game) });
  const action = chooseAlphaBetaAction(game, {
    ...options,
    trace: (event) => logger.search(game.id, searchLogName, { ...event, gameId: game.id, botId: "alpha-beta" })
  });
  if (!action) {
    logger.game(game.id, { type: "standalone_bot_action_failed", botId: "alpha-beta", searchLog: searchLogName });
    res.status(422).json({ error: "Bot could not find a legal action." });
    return;
  }

  logger.game(game.id, { type: "standalone_bot_action_selected", botId: "alpha-beta", action, searchLog: searchLogName });
  res.json({ action });
});

app.post("/api/games", (req, res) => {
  const mode = req.body?.mode === "bot" ? "bot" : ("local" satisfies GameMode);
  const game = createGame(mode);
  games.set(game.id, game);
  turnCounts.set(game.id, 0);
  logger.game(game.id, { type: "game_created", mode, state: summarizeState(game) });
  res.status(201).json({ game });
});

app.get("/api/games/:id", (req, res) => {
  const game = games.get(req.params.id);
  if (!game) {
    res.status(404).json({ error: "Game not found." });
    return;
  }

  res.json({ game, legalMoves: getLegalMoves(game, game.activePlayer) });
});

app.post("/api/games/:id/actions", (req, res) => {
  const game = games.get(req.params.id);
  if (!game) {
    res.status(404).json({ error: "Game not found." });
    return;
  }

  const action = normalizeAction(req.body);
  if (!action) {
    res.status(400).json({ error: "Invalid action payload." });
    return;
  }

  const before = summarizeState(game);
  const result = applyAction(game, action);
  if (!result.ok) {
    logger.game(game.id, { type: "human_action_rejected", actor: game.activePlayer, action, before, error: result.error });
    res.status(422).json(result);
    return;
  }

  incrementTurn(result.state.id);
  logger.game(result.state.id, { type: "human_action_applied", actor: game.activePlayer, action, before, after: summarizeState(result.state), status: result.state.status, winner: result.state.winner });
  if (result.state.status === "finished") {
    logger.game(result.state.id, { type: "game_finished", winner: result.state.winner, finalState: summarizeState(result.state) });
  }
  games.set(result.state.id, result.state);
  res.json({ ...result, legalMoves: result.state.status === "playing" ? getLegalMoves(result.state, result.state.activePlayer) : [] });
});

app.post("/api/games/:id/bot-actions", async (req, res) => {
  const game = games.get(req.params.id);
  if (!game) {
    res.status(404).json({ error: "Game not found." });
    return;
  }

  if (game.status !== "playing") {
    res.status(422).json({ error: "The game is already finished." });
    return;
  }

  const botId = typeof req.body?.botId === "string" ? req.body.botId : "alpha-beta";
  const bot = (await discoverBots()).find((candidate) => candidate.id === botId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found." });
    return;
  }

  const before = summarizeState(game);
  const turn = nextTurnNumber(game.id);
  const searchLog = searchLogNameFor(game.id, turn);
  const options = resolveAlphaBetaRequestOptions(req.body);
  logger.game(game.id, { type: "bot_action_requested", botId, actor: game.activePlayer, options, before, searchLog });

  const proposed = await requestBotAction(bot, game, options, searchLog);
  if (!proposed) {
    logger.game(game.id, { type: "bot_action_failed", botId, actor: game.activePlayer, searchLog });
    res.status(502).json({ error: "Bot did not return a valid action." });
    return;
  }

  const result = applyAction(game, proposed);
  if (!result.ok) {
    logger.game(game.id, { type: "bot_action_rejected", botId, actor: game.activePlayer, action: proposed, before, error: result.error, searchLog });
    res.status(422).json({ ...result, error: `Bot proposed an illegal action: ${result.error}` });
    return;
  }

  incrementTurn(result.state.id);
  logger.game(result.state.id, { type: "bot_action_applied", botId, actor: game.activePlayer, action: proposed, before, after: summarizeState(result.state), status: result.state.status, winner: result.state.winner, searchLog });
  if (result.state.status === "finished") {
    logger.game(result.state.id, { type: "game_finished", winner: result.state.winner, finalState: summarizeState(result.state) });
  }
  games.set(result.state.id, result.state);
  res.json({ ...result, action: proposed, legalMoves: result.state.status === "playing" ? getLegalMoves(result.state, result.state.activePlayer) : [] });
});

app.use(express.static(distDir));
app.get("*", (_req, res, next) => {
  res.sendFile(path.join(distDir, "index.html"), (error) => {
    if (error) {
      next();
    }
  });
});

app.listen(port, () => {
  console.log(`Quoridor API listening on http://127.0.0.1:${port}`);
});

async function discoverBots(): Promise<BotManifest[]> {
  let entries;
  try {
    entries = await fs.readdir(botsDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = path.join(botsDir, entry.name, "bot.json");
        try {
          const raw = await fs.readFile(manifestPath, "utf8");
          const parsed = JSON.parse(raw) as Partial<BotManifest>;
          if (!isBotManifest(parsed)) {
            return null;
          }
          return { ...parsed, id: parsed.id || entry.name };
        } catch {
          return null;
        }
      })
  );

  return manifests.filter((manifest): manifest is BotManifest => manifest !== null);
}

function isBotManifest(value: Partial<BotManifest>): value is BotManifest {
  return (
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.version === "string" &&
    value.version.length > 0 &&
    typeof value.endpoint === "string" &&
    value.endpoint.length > 0 &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.id === undefined || typeof value.id === "string")
  );
}

function normalizeAction(input: unknown): GameAction | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const action = input as Partial<GameAction>;
  if (action.type === "move") {
    const to = normalizePosition((action as { to?: unknown }).to);
    return to ? { type: "move", to } : null;
  }

  if (action.type === "wall") {
    const wall = normalizeWall((action as { wall?: unknown }).wall);
    return wall ? { type: "wall", wall } : null;
  }

  return null;
}

function normalizeGameState(input: unknown): GameState | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const state = input as GameState;
  if (
    typeof state.id !== "string" ||
    (state.mode !== "local" && state.mode !== "bot") ||
    (state.activePlayer !== "p1" && state.activePlayer !== "p2") ||
    (state.status !== "playing" && state.status !== "finished") ||
    !state.players ||
    !Array.isArray(state.walls)
  ) {
    return null;
  }

  return state;
}

function resolveAlphaBetaRequestOptions(input: unknown): ReturnType<typeof resolveAlphaBetaOptions> {
  const body = input && typeof input === "object" ? (input as { maxDepth?: unknown; timeBudgetMs?: unknown }) : {};
  return resolveAlphaBetaOptions({
    maxDepth: typeof body.maxDepth === "number" ? body.maxDepth : undefined,
    timeBudgetMs: typeof body.timeBudgetMs === "number" ? body.timeBudgetMs : defaultAlphaBetaTimeBudgetMs
  });
}

function parsePositiveInteger(input: string | undefined): number | null {
  if (!input) {
    return null;
  }

  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

async function requestBotAction(bot: BotManifest, state: GameState, options: ReturnType<typeof resolveAlphaBetaOptions>, searchLog: string): Promise<GameAction | null> {
  if (bot.id === "alpha-beta") {
    return chooseAlphaBetaAction(state, {
      ...options,
      trace: (event) => logger.search(state.id, searchLog, { ...event, gameId: state.id, botId: bot.id })
    });
  }

  const url = bot.endpoint.startsWith("/") ? `http://127.0.0.1:${port}${bot.endpoint}` : bot.endpoint;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, maxDepth: options.maxDepth, timeBudgetMs: options.timeBudgetMs })
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { action?: unknown };
  return normalizeAction(payload.action);
}

function summarizeState(state: GameState): Record<string, unknown> {
  return {
    id: state.id,
    mode: state.mode,
    activePlayer: state.activePlayer,
    status: state.status,
    winner: state.winner,
    players: {
      p1: {
        position: state.players.p1.position,
        wallsRemaining: state.players.p1.wallsRemaining,
        goalRow: state.players.p1.goalRow
      },
      p2: {
        position: state.players.p2.position,
        wallsRemaining: state.players.p2.wallsRemaining,
        goalRow: state.players.p2.goalRow
      }
    },
    walls: state.walls
  };
}

function nextTurnNumber(gameId: string): number {
  return (turnCounts.get(gameId) ?? 0) + 1;
}

function incrementTurn(gameId: string): void {
  turnCounts.set(gameId, nextTurnNumber(gameId));
}

function searchLogNameFor(gameId: string, turn: number): string {
  return `${String(turn).padStart(3, "0")}-${Date.now()}-${gameId}`;
}
