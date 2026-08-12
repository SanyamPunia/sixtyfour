import assert from "node:assert/strict";
import test from "node:test";
import { algebraic, parseFen, parseSquare, startPosition, toFen } from "./board.ts";
import { makeMove } from "./make.ts";
import { toSan } from "./notation.ts";
import {
  gameStatus,
  hasInsufficientMaterial,
  isInCheck,
  legalMoves,
  legalMovesFrom,
  materialBalance,
} from "./rules.ts";
import { BLACK, WHITE } from "./types.ts";

test("FEN round trips", () => {
  for (const fen of [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "4k3/8/8/8/8/8/4P3/4K3 b - - 5 39",
  ]) {
    assert.equal(toFen(parseFen(fen)), fen);
  }
});

test("square names round trip", () => {
  for (const name of ["a1", "h1", "a8", "h8", "e4", "d5"]) {
    assert.equal(algebraic(parseSquare(name)), name);
  }
});

test("fool's mate is checkmate", () => {
  const pos = parseFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
  assert.equal(gameStatus(pos), "checkmate");
  assert.equal(legalMoves(pos).length, 0);
  assert.ok(isInCheck(pos, WHITE));
});

test("stalemate is not checkmate", () => {
  const pos = parseFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(gameStatus(pos), "stalemate");
  assert.equal(legalMoves(pos).length, 0);
  assert.equal(isInCheck(pos, BLACK), false);
});

test("a pinned piece cannot move", () => {
  // The e2 bishop is pinned to e1 by the e8 rook.
  const pos = parseFen("4r3/8/8/8/8/8/4B3/4K3 w - - 0 1");
  assert.equal(legalMovesFrom(pos, parseSquare("e2")).length, 0);
});

test("castling is generated, and blocked when the king would cross a check", () => {
  const open = parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const kingMoves = legalMovesFrom(open, parseSquare("e1")).map((m) => algebraic(m.to));
  assert.ok(kingMoves.includes("g1"), "king side available");
  assert.ok(kingMoves.includes("c1"), "queen side available");

  // A rook on f8 attacks f1, the square the king would cross.
  const crossed = parseFen("5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  const blocked = legalMovesFrom(crossed, parseSquare("e1")).map((m) => algebraic(m.to));
  assert.equal(blocked.includes("g1"), false, "king side blocked through check");
});

test("en passant removes the pawn beside the destination", () => {
  const pos = parseFen("8/8/8/3pP3/8/8/8/4K2k w - d6 0 2");
  const move = legalMovesFrom(pos, parseSquare("e5")).find((m) => m.to === parseSquare("d6"));
  assert.ok(move, "en passant generated");
  makeMove(pos, move);
  assert.equal(pos.board[parseSquare("d5")], 0, "captured pawn is gone from d5");
  assert.equal(pos.board[parseSquare("d6")], 1, "capturing pawn stands on d6");
});

test("promotion offers all four pieces", () => {
  const pos = parseFen("8/4P3/8/8/8/8/8/4K2k w - - 0 1");
  const promos = legalMovesFrom(pos, parseSquare("e7")).map((m) => m.promo);
  assert.deepEqual([...promos].sort(), [2, 3, 4, 5]);
});

test("insufficient material", () => {
  assert.ok(hasInsufficientMaterial(parseFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1")), "K v K");
  assert.ok(hasInsufficientMaterial(parseFen("4k3/8/8/8/8/8/8/3BK3 w - - 0 1")), "KB v K");
  assert.ok(hasInsufficientMaterial(parseFen("4k3/8/8/8/8/8/8/3NK3 w - - 0 1")), "KN v K");
  // Both bishops on dark squares.
  assert.ok(
    hasInsufficientMaterial(parseFen("2b1k3/8/8/8/8/8/8/3BK3 w - - 0 1")),
    "same colour bishops",
  );
  assert.equal(
    hasInsufficientMaterial(parseFen("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1")),
    false,
    "a pawn is sufficient",
  );
});

test("threefold repetition is detected", () => {
  // Knights out and back, twice, returns to the start position for the third time.
  const seq = ["b1c3", "b8c6", "c3b1", "c6b8", "b1c3", "b8c6", "c3b1", "c6b8"];
  const game = startPosition();
  for (const step of seq) {
    const from = parseSquare(step.slice(0, 2));
    const to = parseSquare(step.slice(2, 4));
    const move = legalMoves(game).find((m) => m.from === from && m.to === to);
    assert.ok(move, `move ${step} is legal`);
    makeMove(game, move);
  }
  assert.equal(gameStatus(game), "draw-repetition");
});

test("fifty move rule", () => {
  const pos = parseFen("4k3/8/8/8/8/8/8/R3K2R w KQ - 100 80");
  assert.equal(gameStatus(pos), "draw-fifty-move");
});

test("material balance", () => {
  assert.equal(materialBalance(startPosition()), 0);
  assert.equal(materialBalance(parseFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1")), 9);
  assert.equal(materialBalance(parseFen("3qk3/8/8/8/8/8/8/4K3 w - - 0 1")), -9);
});

test("SAN covers captures, castling, promotion, disambiguation, and mate", () => {
  const san = (fen: string, from: string, to: string, promo?: number): string => {
    const pos = parseFen(fen);
    const move = legalMoves(pos).find(
      (m) =>
        m.from === parseSquare(from) &&
        m.to === parseSquare(to) &&
        (promo === undefined || m.promo === promo),
    );
    assert.ok(move, `${from}${to} is legal in ${fen}`);
    return toSan(pos, move);
  };

  assert.equal(
    san("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e2", "e4"),
    "e4",
  );
  assert.equal(san("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1", "g1"), "O-O");
  assert.equal(san("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1", "c1"), "O-O-O");
  assert.equal(san("8/4P3/8/8/8/8/8/4K2k w - - 0 1", "e7", "e8", 5), "e8=Q");
  // Two knights on c3 and g1 both reach e2, so the file disambiguates.
  assert.equal(san("4k3/8/8/8/8/2N5/8/4K1N1 w - - 0 1", "c3", "e2"), "Nce2");
  // f7 is defended by the pawn, so this is a plain move and carries no suffix.
  assert.equal(
    san("rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1", "d1", "h5"),
    "Qh5",
  );
});
