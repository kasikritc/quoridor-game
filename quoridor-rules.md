# Quoridor Rules

## Scope

This document describes the factual rules of standard **Quoridor**. It covers the standard 2-player game and the 4-player rules stated in the rulebook. It does not include strategy, tactics, openings, or advice.

## Components

A standard Quoridor set contains:

- 1 game board
- 20 fences, also commonly called walls
- 4 pawns

The board is a 9 × 9 grid of 81 squares. Fences are placed in the grooves between squares, not on the squares themselves.

## Object of the Game

Each player has a base line: the row of squares on the side of the board where that player’s pawn begins.

The object is to be the first player to reach any square on the line opposite that player’s own base line.

## Setup for 2 Players

1. Each player takes 10 fences.
2. Each player places their pawn in the center square of their own base line.
3. The two pawns begin on opposite sides of the board.
4. A random draw determines who starts.

## Setup for 4 Players

1. The 4 pawns are placed in the center square of each of the 4 sides of the board.
2. Each player takes 5 fences.
3. The 4-player game uses the same rules as the 2-player game, except that a player may not jump over more than one pawn.

## Turn Structure

Players take turns.

On a turn, the active player must choose exactly one of the following actions:

1. Move their pawn.
2. Place one of their remaining fences.

A player who has no fences remaining must move their pawn on their turn.

## Pawn Movement

### Basic Pawn Movement

A pawn moves one square at a time.

A pawn may move:

- horizontally
- vertically
- forward
- backward

A pawn may not move diagonally as a normal move.

A pawn may not move through a fence. If a fence blocks the direct path between two adjacent squares, a pawn must go around the fence.

### Occupied Squares

A pawn may not finish a normal one-square move on a square occupied by another pawn.

### Face-to-Face Jump

When two pawns are on neighboring squares and no fence separates them, the player whose turn it is may jump over the other pawn and place their pawn on the square immediately behind that pawn.

This jump is allowed only when the square immediately behind the other pawn is reachable.

### Side Move When a Jump Is Blocked

If two pawns are on neighboring squares with no fence between them, but a fence behind the other pawn prevents the straight jump, the moving player may place their pawn on a square to the left or right of the other pawn.

This side move is allowed only because the straight jump is blocked by a fence.

### 4-Player Jump Restriction

In a 4-player game, it is forbidden to jump over more than one pawn.

## Fence Placement

### How Fences Are Placed

A fence must be placed between 2 sets of 2 squares.

This means a fence covers the full boundary between two adjacent pairs of squares. A fence is placed either horizontally or vertically in the grooves between squares.

### What Fences Do

A fence blocks movement across the boundary it covers.

Pawns do not move through fences. Pawns must move around them.

### Fence Supply

Each fence belongs to a player’s supply until placed.

Once a player has used all their fences, that player can no longer place fences and must move their pawn on future turns.

### Required Access to the Goal Line

A fence placement is not legal if it completely prevents a player from reaching that player’s goal line.

After every legal fence placement, every player must still have at least one possible path to their own goal line.

### Invalid Fence Placements

A fence placement is invalid if it:

- is not placed between 2 sets of 2 squares
- is placed so that it does not cover exactly the required two-square length
- overlaps an existing fence
- crosses through an existing fence
- completely blocks a player from reaching their goal line
- is attempted by a player with no fences remaining

## End of the Game

The game ends immediately when a player reaches any one of the 9 squares on the line opposite that player’s base line.

That player is the winner.

## Rule Demonstrations

The following demonstrations use coordinates only to describe board positions. They are not a separate official notation system.

Assume the board is labeled from `a1` to `i9`, with `a1` in one corner, files `a` through `i` running left to right, and ranks `1` through `9` running bottom to top.

### Valid Pawn Move

If a pawn is on `e2`, and there is no fence between `e2` and `e3`, moving from `e2` to `e3` is valid because it is a one-square vertical move.

### Invalid Pawn Move: Diagonal Movement

If a pawn is on `e2`, moving from `e2` to `f3` is invalid as a normal move because normal pawn movement is not diagonal.

### Invalid Pawn Move: Moving Through a Fence

If a pawn is on `e2` and a fence blocks the boundary between `e2` and `e3`, moving from `e2` to `e3` is invalid because pawns may not move through fences.

### Valid Straight Jump

If one pawn is on `e4`, another pawn is on `e5`, no fence separates `e4` and `e5`, and no fence blocks the square behind `e5`, the pawn on `e4` may jump to `e6`.

### Valid Side Move When a Straight Jump Is Blocked

If one pawn is on `e4`, another pawn is on `e5`, no fence separates `e4` and `e5`, and a fence blocks movement from `e5` to `e6`, the pawn on `e4` may move to the left or right of the pawn on `e5`, provided the chosen side square is reachable.

### Invalid Fence Placement: Blocking All Paths

A fence placement is invalid if, after placing it, a player would have no possible path to any square on that player’s goal line.

### Invalid Fence Placement: Wrong Length or Position

A fence placement is invalid if it does not sit between 2 sets of 2 squares.

### Invalid 4-Player Jump

In a 4-player game, if jumping would require passing over two pawns in a row, that jump is invalid because the 4-player rules forbid jumping over more than one pawn.

## Source Note

This document is based on the published Quoridor rulebook text and publisher product information for the standard game.