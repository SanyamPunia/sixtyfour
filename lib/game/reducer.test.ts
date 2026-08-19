import assert from "node:assert/strict";
import test from "node:test";
import { parseFen, parseSquare } from "../chess/board.ts";
import { gameStatus, isInCheck, legalMoves } from "../chess/rules.ts";
import { BLACK, WHITE } from "../chess/types.ts";
import { initialPieces } from "./piece-state.ts";
import {
  createGame,
  type GameState,
  gameReducer,
  isHumanTurn,
  isOver,
  outcome,
  resultLabel,
} from "./reducer.ts";

/**
 * The promotion flow and the outcome are reducer behaviour, and the reducer is pure.
 *
 * Reaching either through the browser means playing a real game against a bot that has a
 * deliberate think delay. That is slow and depends on how the bot plays, and what would be
 * exercised is still this code. The interface over it is thin.
 */
function gameAt(fen: string): GameState {
  const base = createGame();
  const position = parseFen(fen);
  return { ...base, position, pieces: initialPieces(position) };
}

/** White pawn on b7. It can push to b8 or take on a8 or c8, and all six promote. */
const PROMOTION_READY = "r1r1k3/1P6/8/8/8/8/8/4K3 w - - 0 1";

test("a pawn reaching the last rank pauses for a choice", () => {
  let state = gameAt(PROMOTION_READY);

  state = gameReducer(state, { type: "select", square: parseSquare("b7") });
  assert.equal(state.selected, parseSquare("b7"), "the pawn is held");

  state = gameReducer(state, { type: "select", square: parseSquare("b8") });
  assert.ok(state.pendingPromotion, "the move is held rather than played");
  assert.equal(state.pendingPromotion?.to, parseSquare("b8"));
  assert.deepEqual(
    [...(state.pendingPromotion?.options ?? [])].map((m) => m.promo).sort(),
    [2, 3, 4, 5],
    "one option per piece: knight, bishop, rook, queen",
  );
  assert.equal(state.history.length, 0, "nothing has been played yet");
  assert.equal(isHumanTurn(state), false, "the board is inert until it is answered");
});

test("choosing a piece plays that promotion, not a queen", () => {
  let state = gameAt(PROMOTION_READY);
  state = gameReducer(state, { type: "select", square: parseSquare("b7") });
  state = gameReducer(state, { type: "select", square: parseSquare("b8") });
  state = gameReducer(state, { type: "promote", piece: 2 });

  assert.equal(state.pendingPromotion, null, "the picker is dismissed");
  assert.equal(state.history.length, 1, "the move landed");
  assert.equal(state.history[0]?.promo, 2, "a knight, because a knight was asked for");
  assert.equal(state.position.board[parseSquare("b8")], 2, "a white knight stands on b8");
});

test("a promotion can be backed out of", () => {
  let state = gameAt(PROMOTION_READY);
  state = gameReducer(state, { type: "select", square: parseSquare("b7") });
  state = gameReducer(state, { type: "select", square: parseSquare("b8") });
  state = gameReducer(state, { type: "cancelPromotion" });

  assert.equal(state.pendingPromotion, null);
  assert.equal(state.history.length, 0, "no move was made");
  assert.equal(state.position.board[parseSquare("b7")], 1, "the pawn is still on b7");
  assert.equal(isHumanTurn(state), true, "the board is live again");
});

test("a capture into the last rank also asks", () => {
  let state = gameAt(PROMOTION_READY);
  state = gameReducer(state, { type: "select", square: parseSquare("b7") });
  state = gameReducer(state, { type: "select", square: parseSquare("a8") });
  assert.ok(state.pendingPromotion, "a capture that promotes is still a promotion");
  assert.equal(state.pendingPromotion?.options.length, 4);
});

test("the board ignores input while the choice is open", () => {
  let state = gameAt(PROMOTION_READY);
  state = gameReducer(state, { type: "select", square: parseSquare("b7") });
  state = gameReducer(state, { type: "select", square: parseSquare("b8") });
  const held = state;
  state = gameReducer(state, { type: "select", square: parseSquare("e1") });
  assert.equal(state, held, "selecting elsewhere changes nothing");
  state = gameReducer(state, { type: "grab", square: parseSquare("e1") });
  assert.equal(state, held, "and neither does grabbing");
});

test("the outcome reads from the side to move", () => {
  const live = gameAt(PROMOTION_READY);
  assert.equal(outcome({ ...live, status: "playing" }), null);
  assert.equal(outcome({ ...live, status: "check" }), null, "check is not an ending");

  // The human plays White. At checkmate the side to move is the side that was mated.
  const weAreMated = gameAt("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
  assert.equal(outcome({ ...weAreMated, status: "checkmate" }), "loss");

  const weMated = gameAt("r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4");
  assert.equal(outcome({ ...weMated, status: "checkmate" }), "win");

  for (const status of [
    "stalemate",
    "draw-fifty-move",
    "draw-repetition",
    "draw-insufficient",
  ] as const) {
    assert.equal(outcome({ ...live, status }), "draw", status);
  }
});

test("every ending says which ending it was", () => {
  const live = gameAt(PROMOTION_READY);
  assert.equal(resultLabel({ ...live, status: "playing" }), null);
  assert.equal(resultLabel({ ...live, status: "check" }), null, "check is not an ending");

  // A draw has four causes and a player cannot act on "draw" alone. Stalemating a lone
  // king from a winning position is the one that most needs saying out loud.
  assert.equal(resultLabel({ ...live, status: "stalemate" }), "stalemate");
  assert.equal(resultLabel({ ...live, status: "draw-fifty-move" }), "draw, fifty moves");
  assert.equal(resultLabel({ ...live, status: "draw-repetition" }), "draw, repetition");
  assert.equal(resultLabel({ ...live, status: "draw-insufficient" }), "draw, no mate possible");

  const weAreMated = gameAt("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
  assert.equal(resultLabel({ ...weAreMated, status: "checkmate" }), "you lose");
  const weMated = gameAt("r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4");
  assert.equal(resultLabel({ ...weMated, status: "checkmate" }), "you win");
});

test("a lone king with nowhere to go is a stalemate, not a loss", () => {
  // Black is a queen and a rook up, and has taken every square from the white king
  // without checking it. This is the position the visible label has to explain.
  const pos = parseFen("7k/8/8/8/8/8/5q2/7K w - - 0 1");
  assert.equal(gameStatus(pos), "stalemate");
  assert.equal(legalMoves(pos).length, 0, "white has no move");
  assert.equal(isInCheck(pos, WHITE), false, "and is not in check, which is the whole point");
});

/**
 * Room mode, which the reducer knows about only as a flag.
 *
 * The value of the flag is that exactly one opponent is live at a time, and that the two
 * ways a game can restart cannot be reached locally while a second player is relying on
 * the board staying where it is.
 */

function play(state: GameState, from: string, to: string): GameState {
  const after = gameReducer(state, { type: "select", square: parseSquare(from) });
  return gameReducer(after, { type: "select", square: parseSquare(to) });
}

test("entering a room takes the seat's colour and replays what has happened", () => {
  const state = gameReducer(createGame(), {
    type: "enterRoom",
    color: BLACK,
    moves: ["e2e4", "e7e5", "g1f3"],
    resigned: null,
  });

  assert.equal(state.opponent, "room");
  assert.equal(state.humanColor, BLACK);
  assert.equal(state.history.length, 3);
  assert.equal(state.position.side, BLACK, "it should be the joining player's move");
  assert.deepEqual(state.lastMove, {
    from: parseSquare("g1"),
    to: parseSquare("f3"),
  });
});

test("the other player's pieces do not answer a tap", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: WHITE,
    moves: ["e2e4"],
    resigned: null,
  });
  assert.equal(room.position.side, BLACK, "it is their move");

  const tapped = gameReducer(room, { type: "select", square: parseSquare("e7") });
  assert.equal(tapped, room, "one of their pawns was picked up");

  const grabbed = gameReducer(room, { type: "grab", square: parseSquare("e7") });
  assert.equal(grabbed, room, "one of their pawns was dragged");

  const ours = gameReducer(room, { type: "select", square: parseSquare("d2") });
  assert.equal(ours, room, "one of ours was picked up out of turn");

  // And the board comes back the moment the turn does, so nothing above froze it.
  const back = gameReducer(room, { type: "syncRoom", moves: ["e2e4", "e7e5"], resigned: null });
  const held = gameReducer(back, { type: "select", square: parseSquare("d2") });
  assert.equal(held.selected, parseSquare("d2"));
  assert.equal(held.legalTargets.length, 2, "the pawn can push one square or two");
});

test("a sync that agrees with the board changes nothing a player would see", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: WHITE,
    moves: [],
    resigned: null,
  });
  const moved = play(room, "e2", "e4");
  const synced = gameReducer(moved, { type: "syncRoom", moves: ["e2e4"], resigned: null });

  assert.deepEqual(
    synced.pieces.map((p) => `${p.id}@${p.square}`).sort(),
    moved.pieces.map((p) => `${p.id}@${p.square}`).sort(),
    "a confirming sync moved or renamed a piece",
  );
  assert.equal(synced.history.length, 1);
});

test("a sync rolls back a move the room never accepted", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: WHITE,
    moves: [],
    resigned: null,
  });
  const optimistic = play(room, "e2", "e4");
  assert.equal(optimistic.history.length, 1);

  // The room says that move never happened.
  const corrected = gameReducer(optimistic, { type: "syncRoom", moves: [], resigned: null });
  assert.deepEqual(corrected.history, []);
  assert.equal(corrected.position.side, WHITE, "the turn did not come back");
  assert.equal(corrected.lastMove, null);
  // Piece identity survives the correction, so the pawn slides home rather than reappearing.
  assert.equal(corrected.pieces.length, 32);
  assert.deepEqual(
    corrected.pieces.map((p) => p.id).sort(),
    initialPieces(createGame().position)
      .map((p) => p.id)
      .sort(),
  );
});

test("a sync is ignored outside a room", () => {
  // A message from a connection that has already been left must not rewrite a local game.
  const local = play(createGame(), "e2", "e4");
  const after = gameReducer(local, {
    type: "syncRoom",
    moves: ["d2d4", "d7d5"],
    resigned: null,
  });
  assert.equal(after, local, "a stale room message reached a bot game");
});

test("a room game cannot be restarted or re-sided from this browser alone", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: WHITE,
    moves: ["e2e4"],
    resigned: null,
  });
  assert.equal(gameReducer(room, { type: "newGame" }), room, "new game cleared a shared board");
  assert.equal(
    gameReducer(room, { type: "setSide", color: BLACK }),
    room,
    "a player changed seats mid-game",
  );
});

test("leaving a room returns to a fresh game against the bot", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: BLACK,
    moves: ["e2e4"],
    resigned: null,
  });
  const left = gameReducer(room, { type: "leaveRoom" });
  assert.equal(left.opponent, "bot");
  assert.deepEqual(left.history, []);
  assert.equal(left.humanColor, BLACK, "the side being played was thrown away");
  assert.notEqual(left.resetToken, room.resetToken);
});

/**
 * Giving the game up.
 *
 * The only ending that is not a fact about the board, so it is the only one both players
 * have to be *told* about rather than being able to work out by looking.
 */
test("a resignation ends the game for whoever gave it up", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: WHITE,
    moves: ["e2e4"],
    resigned: null,
  });
  const gone = gameReducer(room, { type: "syncRoom", moves: ["e2e4"], resigned: WHITE });

  assert.equal(isOver(gone), true, "the game carried on");
  assert.equal(resultLabel(gone), "you resigned");
  assert.equal(outcome(gone), "loss");
  assert.equal(isHumanTurn(gone), false, "a resigned game was still playable");
});

test("and hands the other player a result that says why", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: BLACK,
    moves: ["e2e4"],
    resigned: null,
  });
  const won = gameReducer(room, { type: "syncRoom", moves: ["e2e4"], resigned: WHITE });

  // "you win" on its own, with the pieces still even, is the one ending a player cannot
  // explain to themselves and is indistinguishable from a bug.
  assert.equal(resultLabel(won), "you win, they resigned");
  assert.equal(outcome(won), "win");
});

test("a resigned board refuses to move", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: WHITE,
    moves: [],
    resigned: null,
  });
  const gone = gameReducer(room, { type: "syncRoom", moves: [], resigned: WHITE });
  const poked = gameReducer(gone, { type: "select", square: parseSquare("e2") });
  assert.equal(poked, gone, "a piece could still be picked up");
});

test("a rematch clears it", () => {
  const room = gameReducer(createGame(), {
    type: "enterRoom",
    color: WHITE,
    moves: ["e2e4"],
    resigned: null,
  });
  const gone = gameReducer(room, { type: "syncRoom", moves: ["e2e4"], resigned: WHITE });
  // The server clears it and the board follows, or the new game arrives already lost.
  const again = gameReducer(gone, { type: "syncRoom", moves: [], resigned: null });
  assert.equal(isOver(again), false);
  assert.equal(resultLabel(again), null);
});
