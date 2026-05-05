import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyAction, createGame, getLegalMoves, normalizePosition, normalizeWall } from "../src/shared/game";
import type { BotManifest, GameAction, GameMode, GameState } from "../src/shared/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const botsDir = path.join(rootDir, "bots");
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT ?? 8787);

const app = express();
const games = new Map<string, GameState>();

app.use(express.json());

app.get("/api/bots", async (_req, res) => {
  const bots = await discoverBots();
  res.json({ bots });
});

app.post("/api/games", (req, res) => {
  const mode = req.body?.mode === "bot" ? "bot" : ("local" satisfies GameMode);
  const game = createGame(mode);
  games.set(game.id, game);
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

  const result = applyAction(game, action);
  if (!result.ok) {
    res.status(422).json(result);
    return;
  }

  games.set(result.state.id, result.state);
  res.json({ ...result, legalMoves: result.state.status === "playing" ? getLegalMoves(result.state, result.state.activePlayer) : [] });
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
