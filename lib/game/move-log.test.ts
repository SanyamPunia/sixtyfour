import assert from "node:assert/strict";
import test from "node:test";
import { parseFen, parseSquare } from "../chess/board.ts";
import { makeMove } from "../chess/make.ts";
import { fromUci } from "../chess/notation.ts";
import type { Move } from "../chess/types.ts";
import { BISHOP, BLACK, KING, KNIGHT, PAWN, QUEEN, WHITE } from "../chess/types.ts";
import { moveLog } from "./move-log.ts";
import { createGame, gameReducer } from "./reducer.ts";

/**
 * The log is a pure function of the move list, so the moves are decoded straight from UCI
 * against the position they were played in. Nothing here needs a board on screen.
 */
function movesFrom(fen: string, uci: readonly string[]): Move[] {
  const position = parseFen(fen);
  const moves: Move[] = [];
  for (const step of uci) {
    const move = fromUci(position, step);
    assert.ok(move !== null, `${step} is not legal here`);
    makeMove(position, move);
    moves.push(move);
  }
  return moves;
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("a quiet move names the piece that made it and where it landed", () => {
  const log = moveLog(movesFrom(START, ["e2e4", "e7e5", "g1f3"]), WHITE);

  assert.equal(log.length, 3);
  assert.deepEqual(
    log.map((r) => [r.index, r.name, r.square]),
    [
      [1, "pawn", "e4"],
      [2, "pawn", "e5"],
      [3, "knight", "f3"],
    ],
  );
  assert.equal(log[0]?.color, WHITE, "white moved first");
  assert.equal(log[1]?.color, BLACK);
  assert.equal(log[2]?.type, KNIGHT, "the glyph is the piece that moved");
  assert.equal(log[0]?.taken, null, "nothing was taken");
});

test("a capture records the piece taken, with its colour", () => {
  // 1. e4 d5 2. exd5, so White's pawn takes a black pawn.
  const log = moveLog(movesFrom(START, ["e2e4", "d7d5", "e4d5"]), WHITE);
  const capture = log[2];

  assert.equal(capture?.name, "pawn", "the taker");
  assert.deepEqual(capture?.taken, { type: PAWN, color: BLACK }, "the taken");
  assert.equal(capture?.square, "d5");
});

test("en passant names the pawn it took, which was never on the destination", () => {
  // The taken pawn stands on d5 while the capture lands on d6, so the move's own `captured`
  // field is empty and only the flag says a capture happened.
  const log = moveLog(movesFrom(START, ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]), WHITE);
  const ep = log[4];

  assert.equal(ep?.square, "d6");
  assert.deepEqual(ep?.taken, { type: PAWN, color: BLACK }, "en passant reported no capture");
  assert.match(ep?.spoken ?? "", /taking their pawn/);
});

test("a castle is named as one, rather than as a king walking two squares", () => {
  const log = moveLog(movesFrom("4k3/8/8/8/8/8/8/4K2R w K - 0 1", ["e1g1"]), WHITE);

  assert.equal(log[0]?.name, "castles");
  assert.equal(log[0]?.type, KING, "the king carries the glyph");
  assert.equal(log[0]?.square, "g1");
  assert.equal(log[0]?.spoken, "you castled short");
});

test("a long castle says so", () => {
  const log = moveLog(movesFrom("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1", ["e1c1"]), WHITE);
  assert.equal(log[0]?.spoken, "you castled long");
});

test("a promotion draws what the pawn became", () => {
  const log = moveLog(movesFrom("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", ["b7b8q"]), WHITE);

  assert.equal(log[0]?.name, "promotes");
  assert.equal(log[0]?.type, QUEEN, "a pawn glyph would hide the only interesting part");
  assert.equal(log[0]?.spoken, "you promoted a pawn to queen on b8");
});

test("a promotion that also takes reports both", () => {
  // The pawn on b7 takes the rook on a8 and comes out a knight.
  const log = moveLog(movesFrom("r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1", ["b7a8n"]), WHITE);

  assert.equal(log[0]?.type, KNIGHT);
  assert.equal(log[0]?.spoken, "you promoted a pawn to knight on a8, taking their rook");
});

test("who moved is read from the seat, not from the colour", () => {
  const moves = movesFrom(START, ["e2e4", "d7d5", "e4d5"]);

  const asWhite = moveLog(moves, WHITE);
  assert.equal(asWhite[0]?.spoken, "you moved pawn to e4");
  assert.equal(asWhite[1]?.spoken, "opponent moved pawn to d5");
  assert.equal(asWhite[2]?.spoken, "you moved pawn to d5, taking their pawn");

  // Same moves, other side of the board. The capture is now something done to you.
  const asBlack = moveLog(moves, BLACK);
  assert.equal(asBlack[0]?.spoken, "opponent moved pawn to e4");
  assert.equal(asBlack[1]?.spoken, "you moved pawn to d5");
  assert.equal(asBlack[2]?.spoken, "opponent moved pawn to d5, taking your pawn");
});

test("the log follows a game the reducer actually played", () => {
  // The point of the pass: `state.history` is the only input, so a room correction that
  // rebuilds it rebuilds the log with it and there is nothing to keep in step.
  let state = createGame();
  state = gameReducer(state, { type: "select", square: parseSquare("e2") });
  state = gameReducer(state, { type: "select", square: parseSquare("e4") });

  const log = moveLog(state.history, state.humanColor);
  assert.deepEqual(
    log.map((r) => r.spoken),
    ["you moved pawn to e4"],
  );

  const rolled = gameReducer(state, { type: "newGame" });
  assert.deepEqual(moveLog(rolled.history, rolled.humanColor), [], "a new game clears it");
});

test("every piece gets a name", () => {
  const log = moveLog(
    movesFrom("4k3/8/8/8/8/8/8/2B1K2R w K - 0 1", ["c1a3", "e8d8", "h1g1"]),
    WHITE,
  );
  assert.equal(log[0]?.name, "bishop");
  assert.equal(log[0]?.type, BISHOP);
  assert.equal(log[1]?.name, "king");
  assert.equal(log[2]?.name, "rook", "a rook that moves on its own is not a castle");
});
