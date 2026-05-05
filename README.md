# Quoridor Game

A rules-enforced Quoridor web game with a React UI, an Express game API, and a bot-ready integration boundary.

The current version supports standard 2-player Quoridor as local play-and-pass. Bot play is intentionally decoupled: the app discovers bot manifests from `bots/<bot-id>/bot.json`, while the game server remains authoritative for validating moves.

## Features

- 9 x 9 Quoridor board.
- Standard 2-player setup with 10 walls per player.
- Legal pawn moves only, including straight jumps and side moves when jumps are blocked.
- Legal wall placement only, including overlap, crossing, wall supply, and path-preservation checks.
- Immediate win detection when a pawn reaches the opposite baseline.
- Board-first UI with inferred intent:
  - Hover/click a square to move.
  - Hover/click a horizontal or vertical groove to place that wall orientation.
- Express API for game sessions and action validation.
- Bot manifest discovery through `GET /api/bots`.

## Tech Stack

- React 18
- Vite
- TypeScript
- Express
- Vitest

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open the UI:

```text
http://localhost:5173/
```

The API runs on:

```text
http://127.0.0.1:8787/
```

## Scripts

```bash
npm run dev      # Start the Express API and Vite dev server
npm run server   # Start only the Express API
npm run client   # Start only the Vite client
npm run check    # Type-check and run tests
npm run build    # Type-check and build the frontend
```

## Bot Manifests

Bot discovery looks for manifests at:

```text
bots/<bot-id>/bot.json
```

Manifest shape:

```json
{
  "id": "example-bot",
  "name": "Example Bot",
  "version": "0.1.0",
  "endpoint": "http://127.0.0.1:9000",
  "description": "Optional short description."
}
```

Discovery endpoint:

```http
GET /api/bots
```

The game API is the rules authority. Future bots should submit proposed actions to the game server rather than mutating game state directly.

## Game API

Create a game:

```http
POST /api/games
Content-Type: application/json

{ "mode": "local" }
```

Get a game:

```http
GET /api/games/:id
```

Submit a move:

```http
POST /api/games/:id/actions
Content-Type: application/json

{ "type": "move", "to": { "row": 7, "col": 4 } }
```

Submit a wall:

```http
POST /api/games/:id/actions
Content-Type: application/json

{ "type": "wall", "wall": { "row": 3, "col": 4, "orientation": "horizontal" } }
```

Coordinates are zero-based. Board squares use `row` and `col` from `0` to `8`. Wall anchors use `row` and `col` from `0` to `7`.

## Project Structure

```text
server/              Express API server
src/                 React app
src/shared/          Shared game rules and types
tests/               Rule engine tests
bots/                Optional local bot manifests
quoridor-rules.md    Source rules used for implementation
```

## Testing

```bash
npm run check
```

The tests cover pawn movement, jumps, side moves, wall blocking, invalid wall placement, path preservation, wall counts, turn changes, and win detection.

## License

MIT
