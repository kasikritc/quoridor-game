import { describe, expect, it } from "vitest";
import { applyAction, createGame, getLegalMoves, isBlocked, validateWallPlacement } from "../src/shared/game";
import type { GameState, Wall } from "../src/shared/types";

describe("Quoridor rules", () => {
  it("allows only adjacent unblocked normal pawn moves", () => {
    const game = deterministicGame();
    game.activePlayer = "p1";

    expect(getLegalMoves(game, "p1")).toEqual(
      expect.arrayContaining([
        { row: 7, col: 4 },
        { row: 8, col: 3 },
        { row: 8, col: 5 }
      ])
    );

    const result = applyAction(game, { type: "move", to: { row: 6, col: 4 } });
    expect(result.ok).toBe(false);
  });

  it("blocks movement through horizontal and vertical walls", () => {
    const horizontal: Wall = { row: 7, col: 4, orientation: "horizontal" };
    const vertical: Wall = { row: 7, col: 3, orientation: "vertical" };

    expect(isBlocked({ row: 8, col: 4 }, { row: 7, col: 4 }, [horizontal])).toBe(true);
    expect(isBlocked({ row: 8, col: 4 }, { row: 8, col: 3 }, [vertical])).toBe(true);
  });

  it("allows a straight jump over an adjacent opponent", () => {
    const game = deterministicGame();
    game.activePlayer = "p1";
    game.players.p1.position = { row: 4, col: 4 };
    game.players.p2.position = { row: 3, col: 4 };

    expect(getLegalMoves(game, "p1")).toContainEqual({ row: 2, col: 4 });
  });

  it("allows side moves when the straight jump is blocked", () => {
    const game = deterministicGame();
    game.activePlayer = "p1";
    game.players.p1.position = { row: 4, col: 4 };
    game.players.p2.position = { row: 3, col: 4 };
    game.walls = [{ row: 2, col: 4, orientation: "horizontal" }];

    const moves = getLegalMoves(game, "p1");
    expect(moves).toContainEqual({ row: 3, col: 3 });
    expect(moves).toContainEqual({ row: 3, col: 5 });
    expect(moves).not.toContainEqual({ row: 2, col: 4 });
  });

  it("rejects overlapping, crossing, and path-blocking walls", () => {
    const game = deterministicGame();
    game.activePlayer = "p1";
    game.walls = [{ row: 1, col: 1, orientation: "horizontal" }];

    expect(validateWallPlacement(game, { row: 1, col: 1, orientation: "horizontal" }).ok).toBe(false);
    expect(validateWallPlacement(game, { row: 1, col: 0, orientation: "horizontal" }).ok).toBe(false);
    expect(validateWallPlacement(game, { row: 1, col: 2, orientation: "horizontal" }).ok).toBe(false);
    expect(validateWallPlacement(game, { row: 1, col: 3, orientation: "horizontal" }).ok).toBe(true);
    expect(validateWallPlacement(game, { row: 1, col: 1, orientation: "vertical" }).ok).toBe(false);

    game.walls = [{ row: 1, col: 1, orientation: "vertical" }];
    expect(validateWallPlacement(game, { row: 0, col: 1, orientation: "vertical" }).ok).toBe(false);
    expect(validateWallPlacement(game, { row: 2, col: 1, orientation: "vertical" }).ok).toBe(false);
    expect(validateWallPlacement(game, { row: 3, col: 1, orientation: "vertical" }).ok).toBe(true);

    const trapped = deterministicGame();
    trapped.activePlayer = "p1";
    trapped.players.p2.position = { row: 0, col: 0 };
    trapped.walls = [
      { row: 0, col: 0, orientation: "vertical" },
      { row: 0, col: 1, orientation: "vertical" },
      { row: 1, col: 0, orientation: "horizontal" }
    ];

    expect(validateWallPlacement(trapped, { row: 0, col: 0, orientation: "horizontal" }).ok).toBe(false);
  });

  it("decrements wall supply, changes turns, and detects wins", () => {
    const game = deterministicGame();
    game.activePlayer = "p1";

    const wall = applyAction(game, { type: "wall", wall: { row: 5, col: 5, orientation: "horizontal" } });
    expect(wall.ok).toBe(true);
    expect(wall.state.players.p1.wallsRemaining).toBe(9);
    expect(wall.state.activePlayer).toBe("p2");

    const nearlyWon = deterministicGame();
    nearlyWon.activePlayer = "p1";
    nearlyWon.players.p1.position = { row: 1, col: 4 };
    nearlyWon.players.p2.position = { row: 0, col: 2 };
    const win = applyAction(nearlyWon, { type: "move", to: { row: 0, col: 4 } });
    expect(win.ok).toBe(true);
    expect(win.state.status).toBe("finished");
    expect(win.state.winner).toBe("p1");
  });
});

function deterministicGame(): GameState {
  const game = createGame("local");
  game.id = "test-game";
  game.activePlayer = "p1";
  game.createdAt = "2026-05-05T00:00:00.000Z";
  game.updatedAt = "2026-05-05T00:00:00.000Z";
  return game;
}
