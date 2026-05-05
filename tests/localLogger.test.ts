import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalLogger, safePathPart } from "../server/localLogger";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("LocalLogger", () => {
  it("writes game and search records as NDJSON", async () => {
    const rootDir = tempDir();
    const logger = new LocalLogger({ rootDir });

    logger.game("game/1", { type: "game_created", mode: "bot" });
    logger.search("game/1", "turn/1", { type: "search_start", depth: 1 });
    await logger.flush();

    const gameRecords = readJsonl(path.join(rootDir, "games", "game_1.jsonl"));
    const searchRecords = readJsonl(path.join(rootDir, "search", "game_1", "turn_1.jsonl"));

    expect(gameRecords).toMatchObject([{ type: "game_created", mode: "bot" }]);
    expect(searchRecords).toMatchObject([{ type: "search_start", depth: 1 }]);
    expect(gameRecords[0].ts).toEqual(expect.any(String));
    await logger.close();
  });

  it("flushes a large burst of records without dropping entries", async () => {
    const rootDir = tempDir();
    const logger = new LocalLogger({ rootDir });

    for (let index = 0; index < 10_000; index += 1) {
      logger.search("game-1", "turn-1", { type: "node_action_score", index });
    }

    await logger.close();

    const searchRecords = readJsonl(path.join(rootDir, "search", "game-1", "turn-1.jsonl"));
    expect(searchRecords).toHaveLength(10_000);
    expect(searchRecords[0]).toMatchObject({ type: "node_action_score", index: 0 });
    expect(searchRecords[searchRecords.length - 1]).toMatchObject({ type: "node_action_score", index: 9_999 });
  });

  it("flushes oversized bursts in bounded chunks", async () => {
    const rootDir = tempDir();
    const logger = new LocalLogger({ rootDir, maxChunkBytes: 256 });

    for (let index = 0; index < 100; index += 1) {
      logger.search("game-1", "turn-1", { type: "node_action_score", index, payload: "x".repeat(100) });
    }

    await logger.close();

    const searchRecords = readJsonl(path.join(rootDir, "search", "game-1", "turn-1.jsonl"));
    expect(searchRecords).toHaveLength(100);
    expect(searchRecords[0]).toMatchObject({ type: "node_action_score", index: 0 });
    expect(searchRecords[searchRecords.length - 1]).toMatchObject({ type: "node_action_score", index: 99 });
  });

  it("writes search sink records with shared defaults", async () => {
    const rootDir = tempDir();
    const logger = new LocalLogger({ rootDir });
    const sink = logger.searchSink("game-1", "turn-1", { gameId: "game-1", botId: "alpha-beta" });

    sink({ type: "search_start" });
    sink({ type: "search_complete", nodesVisited: 42 });
    await logger.close();

    const searchRecords = readJsonl(path.join(rootDir, "search", "game-1", "turn-1.jsonl"));
    expect(searchRecords).toMatchObject([
      { type: "search_start", gameId: "game-1", botId: "alpha-beta" },
      { type: "search_complete", gameId: "game-1", botId: "alpha-beta", nodesVisited: 42 }
    ]);
  });

  it("sanitizes path parts", () => {
    expect(safePathPart("../game/1")).toBe(".._game_1");
  });

  it("does not throw when logging fails", () => {
    const rootDir = tempDir();
    const blockingFile = path.join(rootDir, "blocked");
    fs.writeFileSync(blockingFile, "not a directory", "utf8");
    const warnings: string[] = [];
    const logger = new LocalLogger({ rootDir: blockingFile, warn: (message) => warnings.push(message) });

    expect(() => logger.game("game-1", { type: "game_created" })).not.toThrow();
    expect(warnings).toHaveLength(1);
  });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quoridor-logs-"));
  tempDirs.push(dir);
  return dir;
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  return fs.readFileSync(filePath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}
