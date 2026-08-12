import assert from "node:assert/strict";
import test from "node:test";
import { kingSquare, parseFen } from "./board.ts";
import { makeMove, unmakeMove } from "./make.ts";
import { generateMoves, isAttacked } from "./moves.ts";
import type { Color, Position } from "./types.ts";

/**
 * Perft counts the leaf nodes of the move tree to a fixed depth. The counts below are the
 * published values for these positions, so a single wrong rule anywhere in generation,
 * make, or unmake shows up as a mismatch.
 */
function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const us = pos.side;
  let nodes = 0;
  for (const move of generateMoves(pos)) {
    makeMove(pos, move);
    if (!isAttacked(pos, kingSquare(pos, us), -us as Color)) {
      nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    }
    unmakeMove(pos, move);
  }
  return nodes;
}

const SUITE: ReadonlyArray<{
  name: string;
  fen: string;
  counts: ReadonlyArray<readonly [depth: number, nodes: number]>;
}> = [
  {
    name: "start position",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    counts: [
      [1, 20],
      [2, 400],
      [3, 8902],
      [4, 197281],
      [5, 4865609],
    ],
  },
  {
    name: "kiwipete",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    counts: [
      [1, 48],
      [2, 2039],
      [3, 97862],
      [4, 4085603],
    ],
  },
  {
    name: "en passant heavy",
    fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    counts: [
      [1, 14],
      [2, 191],
      [3, 2812],
      [4, 43238],
      [5, 674624],
    ],
  },
  {
    name: "promotion heavy",
    fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    counts: [
      [1, 6],
      [2, 264],
      [3, 9467],
      [4, 422333],
    ],
  },
  {
    name: "position 5",
    fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    counts: [
      [1, 44],
      [2, 1486],
      [3, 62379],
      [4, 2103487],
    ],
  },
  {
    name: "position 6",
    fen: "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    counts: [
      [1, 46],
      [2, 2079],
      [3, 89890],
      [4, 3894594],
    ],
  },
];

for (const { name, fen, counts } of SUITE) {
  for (const [depth, expected] of counts) {
    test(`perft ${name} depth ${depth}`, () => {
      assert.equal(perft(parseFen(fen), depth), expected);
    });
  }
}

test("make and unmake restore the position exactly", () => {
  for (const { fen } of SUITE) {
    const pos = parseFen(fen);
    const before = {
      board: Array.from(pos.board),
      side: pos.side,
      rights: pos.rights,
      ep: pos.ep,
      halfmove: pos.halfmove,
      fullmove: pos.fullmove,
      whiteKing: pos.whiteKing,
      blackKing: pos.blackKing,
      hash: pos.hash,
    };
    for (const move of generateMoves(pos)) {
      makeMove(pos, move);
      unmakeMove(pos, move);
    }
    assert.deepEqual(Array.from(pos.board), before.board, "board");
    assert.equal(pos.side, before.side, "side");
    assert.equal(pos.rights, before.rights, "castling rights");
    assert.equal(pos.ep, before.ep, "en passant square");
    assert.equal(pos.halfmove, before.halfmove, "halfmove clock");
    assert.equal(pos.fullmove, before.fullmove, "fullmove number");
    assert.equal(pos.whiteKing, before.whiteKing, "white king square");
    assert.equal(pos.blackKing, before.blackKing, "black king square");
    assert.equal(pos.hash, before.hash, "zobrist hash");
  }
});
