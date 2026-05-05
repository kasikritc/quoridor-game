import { Bot, RotateCcw, Swords } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BOARD_SIZE, WALL_GRID_SIZE, getLegalMoves, positionKey, validateWallPlacement, wallKey } from "./shared/game";
import type { BotManifest, GameAction, GameMode, GameState, Position, Wall } from "./shared/types";

type Screen = "home" | "game" | "bots";

const files = "abcdefghi";

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [game, setGame] = useState<GameState | null>(null);
  const [bots, setBots] = useState<BotManifest[]>([]);
  const [selectedBot, setSelectedBot] = useState<BotManifest | null>(null);
  const [botErrorGameId, setBotErrorGameId] = useState<string | null>(null);
  const [botsLoading, setBotsLoading] = useState(false);
  const [message, setMessage] = useState("Choose a mode to start.");
  const [hoverCell, setHoverCell] = useState<Position | null>(null);
  const [hoverWall, setHoverWall] = useState<Wall | null>(null);
  const [invalidMoveFeedback, setInvalidMoveFeedback] = useState<Position | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const legalMoves = useMemo(() => {
    if (!game || game.status !== "playing") {
      return [];
    }
    return getLegalMoves(game, game.activePlayer);
  }, [game]);

  const legalMoveKeys = useMemo(() => new Set(legalMoves.map(positionKey)), [legalMoves]);

  const current = game ? game.players[game.activePlayer] : null;
  const isBotTurn = game?.mode === "bot" && game.activePlayer === "p2" && game.status === "playing";

  useEffect(() => {
    if (!invalidMoveFeedback) {
      return;
    }

    const timeout = window.setTimeout(() => setInvalidMoveFeedback(null), 900);
    return () => window.clearTimeout(timeout);
  }, [invalidMoveFeedback]);

  useEffect(() => {
    if (!game || !selectedBot || !isBotTurn || submitting || botErrorGameId === game.id) {
      return;
    }

    void submitBotAction(game.id, selectedBot.id);
  }, [game, selectedBot, isBotTurn, submitting, botErrorGameId]);

  async function start(mode: GameMode) {
    setMessage(mode === "bot" ? "Loading installed bots." : "Starting local game.");
    if (mode === "local") {
      setSelectedBot(null);
    }
    if (mode === "bot") {
      setScreen("bots");
      setBotsLoading(true);
      try {
        const response = await fetch("/api/bots");
        const data = (await response.json()) as { bots?: BotManifest[] };
        setBots(data.bots ?? []);
        setMessage((data.bots ?? []).length > 0 ? "Pick a bot to play." : "No bots found in bots/<bot-id>/bot.json.");
      } catch {
        setBots([]);
        setMessage("Could not reach the bot registry.");
      } finally {
        setBotsLoading(false);
      }
      return;
    }

    await createServerGame("local");
  }

  async function startBotGame(bot: BotManifest) {
    setSelectedBot(bot);
    await createServerGame("bot", `Playing against ${bot.name}.`);
  }

  async function resetGame() {
    if (!game) {
      setScreen("home");
      return;
    }

    await createServerGame(game.mode);
  }

  async function createServerGame(mode: GameMode, nextMessage?: string) {
    setSubmitting(true);
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      if (!response.ok) {
        throw new Error("Game creation failed.");
      }
      const data = (await response.json()) as { game: GameState };
      setGame(data.game);
      setBotErrorGameId(null);
      setHoverCell(null);
      setHoverWall(null);
      setScreen("game");
      setMessage(nextMessage ?? `${data.game.players[data.game.activePlayer].name} starts.`);
    } catch {
      setMessage("Could not create a game session.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAction(action: GameAction) {
    if (!game || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/games/${game.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action)
      });
      const result = (await response.json()) as { ok?: boolean; state?: GameState; error?: string };
      if (!response.ok || !result.ok || !result.state) {
        setMessage(result.error ?? "That action is not legal.");
        return;
      }

      setGame(result.state);
      setBotErrorGameId(null);
      setHoverCell(null);
      setHoverWall(null);
      setInvalidMoveFeedback(null);
      if (result.state.status === "finished" && result.state.winner) {
        setMessage(`${result.state.players[result.state.winner].name} wins.`);
      } else {
        setMessage(`${result.state.players[result.state.activePlayer].name}'s turn.`);
      }
    } catch {
      setMessage("Could not submit the action.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBotAction(gameId: string, botId: string) {
    setSubmitting(true);
    setBotErrorGameId(null);
    setMessage(`${selectedBot?.name ?? "Bot"} is thinking.`);
    try {
      const response = await fetch(`/api/games/${gameId}/bot-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId })
      });
      const result = (await response.json()) as { ok?: boolean; state?: GameState; error?: string };
      if (!response.ok || !result.ok || !result.state) {
        setMessage(result.error ?? "The bot could not move.");
        setBotErrorGameId(gameId);
        return;
      }

      setGame(result.state);
      setHoverCell(null);
      setHoverWall(null);
      setInvalidMoveFeedback(null);
      if (result.state.status === "finished" && result.state.winner) {
        setMessage(`${result.state.players[result.state.winner].name} wins.`);
      } else {
        setMessage(`${result.state.players[result.state.activePlayer].name}'s turn.`);
      }
    } catch {
      setMessage("Could not request a bot action.");
      setBotErrorGameId(gameId);
    } finally {
      setSubmitting(false);
    }
  }

  function onCellClick(position: Position) {
    if (!game || game.status !== "playing" || isBotTurn) {
      return;
    }

    if (!legalMoveKeys.has(positionKey(position))) {
      setInvalidMoveFeedback(position);
      setMessage("That pawn move is not legal.");
      return;
    }

    void submitAction({ type: "move", to: position });
  }

  function onWallClick(wall: Wall) {
    if (!game || game.status !== "playing" || isBotTurn) {
      return;
    }

    void submitAction({ type: "wall", wall });
  }

  if (screen === "home") {
    return (
      <main className="app-shell home-shell">
        <section className="mode-panel" aria-labelledby="title">
          <div>
            <p className="eyebrow">9 x 9 strategy board</p>
            <h1 id="title">Quoridor</h1>
            <p className="intro">Race to the opposite baseline. Move one square, jump when face-to-face, or place walls while preserving every player's path.</p>
          </div>
          <div className="mode-grid">
            <button className="mode-card" onClick={() => void start("local")}>
              <Swords aria-hidden="true" />
              <span>Local play-and-pass</span>
              <small>Two players on this machine</small>
            </button>
            <button className="mode-card" onClick={() => void start("bot")}>
              <Bot aria-hidden="true" />
              <span>Play with bot</span>
              <small>Scan installed bot manifests</small>
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "bots") {
    return (
      <main className="app-shell">
        <header className="topbar">
          <button className="ghost-button" onClick={() => setScreen("home")}>Back</button>
          <div>
            <p className="eyebrow">Bot registry</p>
            <h1>Installed bots</h1>
          </div>
          <button className="primary-button" onClick={() => bots[0] && void startBotGame(bots[0])} disabled={submitting || bots.length === 0}>Play first bot</button>
        </header>
        <section className="bot-list">
          {botsLoading ? <p className="empty">Scanning bots...</p> : null}
          {!botsLoading && bots.length === 0 ? <p className="empty">No bots found. Add manifests at bots/&lt;bot-id&gt;/bot.json.</p> : null}
          {bots.map((bot) => (
            <article className="bot-card" key={bot.id}>
              <Bot aria-hidden="true" />
              <div>
                <h2>{bot.name}</h2>
                <p>{bot.description || "No description provided."}</p>
                <span>{bot.version} · {bot.endpoint}</span>
              </div>
              <button className="primary-button" onClick={() => void startBotGame(bot)} disabled={submitting}>Play</button>
            </article>
          ))}
        </section>
        <p className="status-line">{message}</p>
      </main>
    );
  }

  if (!game || !current) {
    return null;
  }

  const hoverValidation = hoverWall && game.status === "playing" ? validateWallPlacement(game, hoverWall) : null;
  const hoveredMoveIsLegal = hoverCell ? legalMoveKeys.has(positionKey(hoverCell)) : false;
  const statusText = getStatusText(game, message, hoverCell, hoverWall, hoveredMoveIsLegal, hoverValidation);

  return (
    <main className="game-shell">
      <aside className="side-panel">
        <button className="ghost-button" onClick={() => setScreen("home")}>Modes</button>
        <div>
          <p className="eyebrow">{game.mode === "bot" ? "Bot-ready game" : "Local game"}</p>
          <h1>Quoridor</h1>
        </div>
        <section className="sidebar-section turn-section" aria-label="Current turn">
          <div className="turn-card">
            <span className={`player-token ${game.activePlayer}`} />
            <div>
              <p>{game.status === "finished" ? "Winner" : "Turn"}</p>
              <strong>{game.status === "finished" && game.winner ? game.players[game.winner].name : current.name}</strong>
            </div>
          </div>
        </section>
        <section className="sidebar-section" aria-label="Wall supply">
          <p className="section-label">Walls remaining</p>
          <div className="score-grid">
            <PlayerMeter game={game} playerId="p1" />
            <PlayerMeter game={game} playerId="p2" />
          </div>
        </section>
        <section className="sidebar-section" aria-label="Board intent">
          <p className="section-label">Board intent</p>
          <div className="intent-card">
            <strong>{hoverWall ? "Wall placement" : hoverCell ? "Pawn move" : "Board ready"}</strong>
            <span>Hover a square to move. Hover a groove to place its wall.</span>
          </div>
          <p className={hoverValidation?.ok === false || (hoverCell && !hoveredMoveIsLegal && game.status === "playing") ? "status-line error" : "status-line"}>{statusText}</p>
        </section>
        <section className="sidebar-section controls-section" aria-label="Game controls">
          <button className="primary-button" onClick={() => void resetGame()} disabled={submitting}>
            <RotateCcw aria-hidden="true" />
            New game
          </button>
        </section>
      </aside>

      <section className="board-wrap" aria-label="Quoridor board">
        <div className="board">
          {Array.from({ length: BOARD_SIZE }).map((_, row) =>
            Array.from({ length: BOARD_SIZE }).map((__, col) => {
              const position = { row, col };
              const occupant = Object.values(game.players).find((player) => player.position.row === row && player.position.col === col);
              const isLegal = legalMoveKeys.has(positionKey(position));
              const isHovered = hoverCell ? positionKey(hoverCell) === positionKey(position) : false;
              const isInvalidFeedback = invalidMoveFeedback ? positionKey(invalidMoveFeedback) === positionKey(position) : false;
              return (
                <button
                  key={`cell-${row}-${col}`}
                  className={`cell ${isLegal ? "legal" : ""} ${isHovered ? "hovered" : ""} ${isInvalidFeedback ? "illegal-feedback" : ""}`}
                  style={{ gridRow: row * 2 + 1, gridColumn: col * 2 + 1 }}
                  onMouseEnter={() => {
                    setHoverCell(position);
                    setHoverWall(null);
                  }}
                  onFocus={() => {
                    setHoverCell(position);
                    setHoverWall(null);
                  }}
                  onMouseLeave={() => setHoverCell(null)}
                  onBlur={() => setHoverCell(null)}
                  onClick={() => onCellClick(position)}
                  aria-label={`${files[col]}${BOARD_SIZE - row}${isLegal ? ", legal move" : ""}`}
                  disabled={submitting || isBotTurn || game.status === "finished"}
                >
                  {occupant ? <span className={`pawn ${occupant.id}`}>{occupant.id === "p1" ? "B" : "G"}</span> : null}
                </button>
              );
            })
          )}
          {Array.from({ length: WALL_GRID_SIZE }).map((_, row) =>
            Array.from({ length: WALL_GRID_SIZE }).map((__, col) => (
              <button
                key={`hwall-${row}-${col}`}
                className={wallClass(game, hoverWall, { row, col, orientation: "horizontal" })}
                style={{ gridRow: row * 2 + 2, gridColumn: `${col * 2 + 1} / span 3` }}
                onMouseEnter={() => {
                  setHoverWall({ row, col, orientation: "horizontal" });
                  setHoverCell(null);
                }}
                onFocus={() => {
                  setHoverWall({ row, col, orientation: "horizontal" });
                  setHoverCell(null);
                }}
                onMouseLeave={() => setHoverWall(null)}
                onBlur={() => setHoverWall(null)}
                onClick={() => onWallClick({ row, col, orientation: "horizontal" })}
                aria-label={`Horizontal wall ${row + 1}, ${col + 1}`}
                disabled={submitting || isBotTurn || game.status === "finished"}
              />
            ))
          )}
          {Array.from({ length: WALL_GRID_SIZE }).map((_, row) =>
            Array.from({ length: WALL_GRID_SIZE }).map((__, col) => (
              <button
                key={`vwall-${row}-${col}`}
                className={wallClass(game, hoverWall, { row, col, orientation: "vertical" })}
                style={{ gridRow: `${row * 2 + 1} / span 3`, gridColumn: col * 2 + 2 }}
                onMouseEnter={() => {
                  setHoverWall({ row, col, orientation: "vertical" });
                  setHoverCell(null);
                }}
                onFocus={() => {
                  setHoverWall({ row, col, orientation: "vertical" });
                  setHoverCell(null);
                }}
                onMouseLeave={() => setHoverWall(null)}
                onBlur={() => setHoverWall(null)}
                onClick={() => onWallClick({ row, col, orientation: "vertical" })}
                aria-label={`Vertical wall ${row + 1}, ${col + 1}`}
                disabled={submitting || isBotTurn || game.status === "finished"}
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function PlayerMeter({ game, playerId }: { game: GameState; playerId: "p1" | "p2" }) {
  const player = game.players[playerId];
  return (
    <div className="player-meter">
      <span className={`player-token ${playerId}`} />
      <div>
        <strong>{player.name}</strong>
        <small>{player.wallsRemaining} walls</small>
      </div>
    </div>
  );
}

function wallClass(game: GameState, hoverWall: Wall | null, wall: Wall): string {
  const placed = game.walls.some((existing) => wallKey(existing) === wallKey(wall));
  const hovered = hoverWall && wallKey(hoverWall) === wallKey(wall);
  const validation = hovered && game.status === "playing" ? validateWallPlacement(game, wall) : null;
  return [
    "wall-slot",
    wall.orientation,
    placed ? "placed" : "",
    hovered && game.status === "playing" ? "preview" : "",
    hovered && game.status === "playing" && validation?.ok === false ? "invalid" : ""
  ].join(" ");
}

function getStatusText(
  game: GameState,
  fallback: string,
  hoverCell: Position | null,
  hoverWall: Wall | null,
  hoveredMoveIsLegal: boolean,
  hoverValidation: ReturnType<typeof validateWallPlacement> | null
): string {
  if (game.status === "finished") {
    return game.winner ? `${game.players[game.winner].name} wins.` : fallback;
  }

  if (hoverValidation) {
    if (!hoverValidation.ok) {
      return hoverValidation.error;
    }
    return `Place ${hoverWall?.orientation ?? ""} wall.`;
  }

  if (hoverCell) {
    const coordinate = `${files[hoverCell.col]}${BOARD_SIZE - hoverCell.row}`;
    return hoveredMoveIsLegal ? `Move to ${coordinate}.` : `${coordinate} is not a legal move.`;
  }

  return fallback;
}
