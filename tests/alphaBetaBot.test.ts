import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_BUDGET_MS, chooseAlphaBetaAction, evaluateState, legalBotActions, resolveAlphaBetaOptions, shortestPathLength } from "../src/shared/alphaBetaBot";
import { applyAction, createGame } from "../src/shared/game";
import type { GameAction, GameState } from "../src/shared/types";

describe("Alpha-beta bot", () => {
  it("generates pawn and wall actions from the initial state", () => {
    const game = deterministicGame();

    const actions = legalBotActions(game, { wallStrategy: "all" });

    expect(actions).toEqual(
      expect.arrayContaining([
        { type: "move", to: { row: 7, col: 4 } },
        { type: "move", to: { row: 8, col: 3 } },
        { type: "move", to: { row: 8, col: 5 } },
        { type: "wall", wall: { row: 0, col: 0, orientation: "horizontal" } },
        { type: "wall", wall: { row: 0, col: 0, orientation: "vertical" } }
      ])
    );
  });

  it("uses shared wall validation for generated wall actions", () => {
    const game = deterministicGame();
    game.walls = [{ row: 1, col: 1, orientation: "horizontal" }];

    const actions = legalBotActions(game, { wallStrategy: "all" });

    expect(actions).not.toContainEqual(wallAction(1, 1, "horizontal"));
    expect(actions).not.toContainEqual(wallAction(1, 0, "horizontal"));
    expect(actions).not.toContainEqual(wallAction(1, 2, "horizontal"));
    expect(actions).not.toContainEqual(wallAction(1, 1, "vertical"));
    expect(actions).toContainEqual(wallAction(1, 3, "horizontal"));
  });

  it("does not generate path-blocking wall actions", () => {
    const game = deterministicGame();
    game.players.p2.position = { row: 0, col: 0 };
    game.walls = [
      { row: 0, col: 0, orientation: "vertical" },
      { row: 0, col: 1, orientation: "vertical" },
      { row: 1, col: 0, orientation: "horizontal" }
    ];

    expect(legalBotActions(game, { wallStrategy: "all" })).not.toContainEqual(wallAction(0, 0, "horizontal"));
  });

  it("focuses wall candidates around paths and pawns by default", () => {
    const game = deterministicGame();

    const focusedActions = legalBotActions(game);

    expect(focusedActions).toContainEqual(wallAction(7, 4, "horizontal"));
    expect(focusedActions).not.toContainEqual(wallAction(0, 0, "horizontal"));
  });

  it("resolves a configurable time budget with a 5 second default", () => {
    expect(resolveAlphaBetaOptions().timeBudgetMs).toBe(DEFAULT_TIME_BUDGET_MS);
    expect(resolveAlphaBetaOptions({ timeBudgetMs: 25, maxDepth: 3 }).timeBudgetMs).toBe(25);
    expect(resolveAlphaBetaOptions({ timeBudgetMs: 25, maxDepth: 3 }).maxDepth).toBe(3);
  });

  it("computes shortest paths without pawn jumps", () => {
    const game = deterministicGame();
    game.players.p1.position = { row: 4, col: 4 };
    game.players.p2.position = { row: 3, col: 4 };

    expect(shortestPathLength(game, "p1")).toBe(4);
  });

  it("scores shorter own paths higher", () => {
    const game = deterministicGame();
    game.players.p1.position = { row: 1, col: 4 };
    game.players.p2.position = { row: 0, col: 4 };

    expect(evaluateState(game, "p1")).toBeGreaterThan(evaluateState(game, "p2"));
  });

  it("scores terminal wins and losses", () => {
    const game = deterministicGame();
    game.status = "finished";
    game.winner = "p1";

    expect(evaluateState(game, "p1")).toBeGreaterThan(0);
    expect(evaluateState(game, "p2")).toBeLessThan(0);
  });

  it("chooses an action accepted by the authoritative game rules", () => {
    const game = deterministicGame();

    const action = chooseAlphaBetaAction(game, { maxDepth: 2, timeBudgetMs: 1_000 });

    expect(action).not.toBeNull();
    expect(applyAction(game, action as GameAction).ok).toBe(true);
  });

  it("chooses deterministically when action priorities tie", () => {
    const game = deterministicGame();

    const first = chooseAlphaBetaAction(game, { maxDepth: 1, timeBudgetMs: 1_000 });
    const second = chooseAlphaBetaAction(game, { maxDepth: 1, timeBudgetMs: 1_000 });

    expect(second).toEqual(first);
  });

  it("returns a legal fallback action with a tiny time budget", () => {
    const game = deterministicGame();

    const action = chooseAlphaBetaAction(game, { timeBudgetMs: 1 });

    expect(action).not.toBeNull();
    expect(applyAction(game, action as GameAction).ok).toBe(true);
  });

  it("takes an immediate winning move", () => {
    const game = deterministicGame();
    game.activePlayer = "p2";
    game.players.p1.position = { row: 1, col: 0 };
    game.players.p2.position = { row: 7, col: 2 };
    game.players.p1.wallsRemaining = 0;
    game.players.p2.wallsRemaining = 0;
    game.walls = [
      { orientation: "horizontal", row: 4, col: 4 },
      { row: 0, col: 5, orientation: "horizontal" },
      { row: 0, col: 7, orientation: "horizontal" },
      { row: 0, col: 3, orientation: "horizontal" },
      { row: 0, col: 1, orientation: "horizontal" },
      { orientation: "horizontal", row: 5, col: 3 },
      { orientation: "horizontal", row: 5, col: 1 },
      { orientation: "vertical", row: 4, col: 3 },
      { orientation: "vertical", row: 4, col: 0 },
      { orientation: "horizontal", row: 4, col: 6 },
      { orientation: "vertical", row: 3, col: 7 },
      { row: 1, col: 0, orientation: "vertical" },
      { orientation: "horizontal", row: 2, col: 7 },
      { row: 2, col: 1, orientation: "horizontal" },
      { row: 2, col: 3, orientation: "horizontal" },
      { row: 2, col: 4, orientation: "vertical" },
      { row: 1, col: 5, orientation: "horizontal" },
      { row: 3, col: 1, orientation: "vertical" },
      { orientation: "horizontal", row: 7, col: 0 },
      { orientation: "vertical", row: 7, col: 1 }
    ];

    const action = chooseAlphaBetaAction(game, { maxDepth: 2, timeBudgetMs: 1_000 });

    expect(action).toEqual({ type: "move", to: { row: 8, col: 2 } });
  });

  it("keeps an immediate win preferred during deeper search", () => {
    const game = deterministicGame();
    game.activePlayer = "p2";
    game.players.p1.position = { row: 5, col: 8 };
    game.players.p2.position = { row: 7, col: 4 };
    game.players.p1.wallsRemaining = 0;
    game.players.p2.wallsRemaining = 0;

    const action = chooseAlphaBetaAction(game, { maxDepth: 4, timeBudgetMs: 1_000 });

    expect(action).toEqual({ type: "move", to: { row: 8, col: 4 } });
  });

  it("does not spend an opening wall when pawn progress is better", () => {
    const game = deterministicGame();
    game.activePlayer = "p2";

    const action = chooseAlphaBetaAction(game, { maxDepth: 1, timeBudgetMs: 1_000 });

    expect(action).toEqual({ type: "move", to: { row: 1, col: 4 } });
  });

  it("still chooses a wall when it clearly delays the opponent", () => {
    const game = deterministicGame();
    game.activePlayer = "p2";
    game.players.p1.position = { row: 1, col: 4 };
    game.players.p2.position = { row: 4, col: 4 };

    const action = chooseAlphaBetaAction(game, { maxDepth: 1, timeBudgetMs: 1_000 });

    expect(action).toEqual({ type: "wall", wall: { row: 0, col: 3, orientation: "horizontal" } });
  });
});

function deterministicGame(): GameState {
  const game = createGame("bot");
  game.id = "bot-test-game";
  game.activePlayer = "p1";
  game.createdAt = "2026-05-05T00:00:00.000Z";
  game.updatedAt = "2026-05-05T00:00:00.000Z";
  return game;
}

function wallAction(row: number, col: number, orientation: "horizontal" | "vertical"): GameAction {
  return { type: "wall", wall: { row, col, orientation } };
}
