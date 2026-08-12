import assert from "node:assert/strict";
import test from "node:test";
import { algebraic, parseFen, startPosition } from "../chess/board.ts";
import { makeMove } from "../chess/make.ts";
import { gameStatus, isGameOver, legalMoves } from "../chess/rules.ts";
import { evaluate } from "./evaluate.ts";
import { chooseMove } from "./levels.ts";
import { search } from "./search.ts";

const HARD = { maxDepth: 20, timeBudgetMs: 400 };

test("the start position evaluates as level", () => {
  assert.equal(evaluate(startPosition()), 0);
});

test("evaluation is from the mover's point of view", () => {
  // White is a queen up. The same position with Black to move must read as negative.
  const whiteToMove = parseFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
  const blackToMove = parseFen("4k3/8/8/8/8/8/8/3QK3 b - - 0 1");
  assert.ok(evaluate(whiteToMove) > 500);
  assert.ok(evaluate(blackToMove) < -500);
});

test("finds mate in one", () => {
  // Back rank: Ra8 is mate.
  const pos = parseFen("6k1/5ppp/8/8/8/8/8/R3K3 w Q - 0 1");
  const result = search(pos, HARD);
  assert.ok(result.best);
  assert.equal(algebraic(result.best.to), "a8");
});

test("takes a free queen", () => {
  const pos = parseFen("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1");
  const result = search(pos, HARD);
  assert.ok(result.best);
  assert.equal(algebraic(result.best.from), "e4");
  assert.equal(algebraic(result.best.to), "d5");
});

test("does not hang its queen to a pawn", () => {
  // Qd5 would be taken by the c6 pawn. Anything else is better.
  const pos = parseFen("4k3/8/2p5/8/8/8/3Q4/4K3 w - - 0 1");
  const result = search(pos, HARD);
  assert.ok(result.best);
  assert.notEqual(algebraic(result.best.to), "d5");
});

test("avoids stalemating when it can win", () => {
  // With K+Q against a cornered king, Qb6 is stalemate and must not be chosen.
  const pos = parseFen("7k/8/6K1/8/8/8/8/1Q6 w - - 0 1");
  const result = search(pos, HARD);
  assert.ok(result.best);
  const after = parseFen("7k/8/6K1/8/8/8/8/1Q6 w - - 0 1");
  makeMove(after, result.best);
  assert.notEqual(gameStatus(after), "stalemate");
});

test("respects its time budget", () => {
  const pos = parseFen("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
  const started = performance.now();
  search(pos, { maxDepth: 20, timeBudgetMs: 300 });
  const elapsed = performance.now() - started;
  // Generous headroom: the clock is only checked every few thousand nodes.
  assert.ok(elapsed < 1500, `took ${elapsed.toFixed(0)}ms`);
});

test("every difficulty returns a legal move", () => {
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    const pos = startPosition();
    const { move } = chooseMove(pos, difficulty, 0.5);
    assert.ok(move, `${difficulty} produced a move`);
    const legal = legalMoves(pos).some(
      (m) => m.from === move.from && m.to === move.to && m.promo === move.promo,
    );
    assert.ok(legal, `${difficulty} produced a legal move`);
  }
});

test("returns null when there are no moves", () => {
  const mated = parseFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
  assert.equal(chooseMove(mated, "hard").move, null);
});

/**
 * The headline claim from the plan: hard beats easy. Ten full games, alternating who
 * moves first so neither level is handed the advantage of the white pieces every time.
 */
test("hard beats easy over ten games", { timeout: 180_000 }, () => {
  let hardWins = 0;
  let draws = 0;
  let easyWins = 0;

  for (let game = 0; game < 10; game++) {
    const pos = startPosition();
    const hardIsWhite = game % 2 === 0;
    let plies = 0;

    while (plies < 180) {
      const status = gameStatus(pos);
      if (isGameOver(status)) break;
      const whiteToMove = pos.side === 1;
      const difficulty = whiteToMove === hardIsWhite ? "hard" : "easy";
      // A fixed sequence per game keeps the result reproducible.
      const { move } = chooseMove(pos, difficulty, ((game * 31 + plies * 17) % 100) / 100);
      if (move === null) break;
      makeMove(pos, move);
      plies += 1;
    }

    const status = gameStatus(pos);
    if (status === "checkmate") {
      // The side to move is the one that got mated.
      const loserIsWhite = pos.side === 1;
      if (loserIsWhite === hardIsWhite) easyWins += 1;
      else hardWins += 1;
    } else {
      draws += 1;
    }
  }

  console.log(`      hard ${hardWins}, draws ${draws}, easy ${easyWins}`);
  assert.equal(easyWins, 0, "easy never beats hard");
  assert.ok(hardWins >= 6, `hard won ${hardWins} of 10`);
});
