import assert from "node:assert/strict";
import test from "node:test";
import { parseFen, parseSquare } from "../chess/board.ts";
import { initialPieces } from "./piece-state.ts";
import { createGame, type GameState, gameReducer, isHumanTurn, outcome } from "./reducer.ts";

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
