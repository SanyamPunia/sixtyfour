/**
 * Every transition the game can make.
 *
 * The reducer owns all of it. Components read state and dispatch, and never reach into a
 * position or a piece list themselves.
 */

import { at, clonePosition, kingSquare, startPosition } from "@/lib/chess/board.ts";
import { makeMove } from "@/lib/chess/make.ts";
import { gameStatus, isGameOver, isInCheck, legalMoves } from "@/lib/chess/rules.ts";
import type { Color, GameStatus, Move, Position, Square } from "@/lib/chess/types.ts";
import { EMPTY, FLAG_CASTLE, WHITE } from "@/lib/chess/types.ts";
import { applyMoveToPieces, initialPieces, type PieceView } from "./piece-state.ts";

export type Difficulty = "easy" | "medium" | "hard";

export interface GameState {
  position: Position;
  pieces: PieceView[];
  humanColor: Color;
  selected: Square | null;
  legalTargets: Move[];
  lastMove: { from: Square; to: Square } | null;
  status: GameStatus;
  difficulty: Difficulty;
  history: Move[];
  /** The rook that must trail the king this move, or null. */
  castlingRookId: string | null;
  /** Bumped to replay the illegal-tap shake, which is otherwise not re-triggerable. */
  shakeToken: number;
  /** Bumped on a new game, so the board can play the reset once and then stop. */
  resetToken: number;
  /** True between the human's move and the bot's reply. */
  thinking: boolean;
}

export type GameAction =
  | { type: "select"; square: Square }
  | { type: "grab"; square: Square }
  | { type: "play"; move: Move }
  | { type: "beginThinking" }
  | { type: "setDifficulty"; difficulty: Difficulty }
  | { type: "newGame" };

export function createGame(difficulty: Difficulty = "medium"): GameState {
  const position = startPosition();
  return {
    position,
    pieces: initialPieces(position),
    humanColor: WHITE,
    selected: null,
    legalTargets: [],
    lastMove: null,
    status: "playing",
    difficulty,
    history: [],
    castlingRookId: null,
    shakeToken: 0,
    resetToken: 0,
    thinking: false,
  };
}

function targetsFrom(pos: Position, square: Square): Move[] {
  return legalMoves(pos).filter((m) => m.from === square);
}

/**
 * Auto-queen.
 *
 * Underpromotion is out of scope, so the four promotion moves the generator produces
 * collapse to the queen. Picking any other one would need a dialog, which this product
 * does not have.
 */
function pickPromotion(moves: readonly Move[]): Move {
  const queening = moves.find((m) => m.promo === 5);
  return queening ?? (moves[0] as Move);
}

function playMove(state: GameState, move: Move): GameState {
  const position = clonePosition(state.position);
  const mover = position.side;

  // The rook's id has to be read before the move, while it still stands on its corner.
  let castlingRookId: string | null = null;
  if ((move.flags & FLAG_CASTLE) !== 0) {
    const rookFrom = move.to > move.from ? move.from + 3 : move.from - 4;
    castlingRookId = state.pieces.find((p) => p.square === rookFrom)?.id ?? null;
  }

  makeMove(position, move);

  return {
    ...state,
    position,
    pieces: applyMoveToPieces(state.pieces, move, mover),
    selected: null,
    legalTargets: [],
    lastMove: { from: move.from, to: move.to },
    status: gameStatus(position),
    history: [...state.history, move],
    castlingRookId,
    thinking: false,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "select": {
      if (isGameOver(state.status) || state.thinking) return state;

      const { position, selected } = state;
      const target = state.legalTargets.filter((m) => m.to === action.square);
      if (target.length > 0) return playMove(state, pickPromotion(target));

      if (selected === action.square) {
        return { ...state, selected: null, legalTargets: [] };
      }

      const piece = at(position.board, action.square);
      const ownPiece = piece !== EMPTY && Math.sign(piece) === position.side;

      if (!ownPiece) {
        // With nothing held, tapping empty space is a no-op. With a piece held, the tap
        // asked for a move that is not available, and the shake says so without any copy.
        // The selection survives, because otherwise there is nothing left to shake.
        return selected === null ? state : { ...state, shakeToken: state.shakeToken + 1 };
      }

      const targets = targetsFrom(position, action.square);
      if (targets.length === 0) {
        // A piece of yours that cannot legally move anywhere. Show it refusing.
        return {
          ...state,
          selected: action.square,
          legalTargets: [],
          shakeToken: state.shakeToken + 1,
        };
      }
      return { ...state, selected: action.square, legalTargets: targets };
    }

    case "grab": {
      // Selection without the toggle. `select` deselects when you tap the held piece
      // again, which during a drag would drop the piece you are still holding.
      if (isGameOver(state.status) || state.thinking) return state;
      if (state.selected === action.square) return state;
      const piece = at(state.position.board, action.square);
      if (piece === EMPTY || Math.sign(piece) !== state.position.side) return state;
      const targets = targetsFrom(state.position, action.square);
      if (targets.length === 0) return state;
      return { ...state, selected: action.square, legalTargets: targets };
    }

    case "play":
      return playMove(state, action.move);

    case "beginThinking":
      return state.thinking ? state : { ...state, thinking: true };

    case "setDifficulty":
      return { ...state, difficulty: action.difficulty };

    case "newGame":
      // The piece ids come from scanning the start position, so they are the same ids the
      // board is already showing. React keeps those nodes, and every surviving piece
      // transitions home instead of popping there.
      return { ...createGame(state.difficulty), resetToken: state.resetToken + 1 };

    default:
      return state;
  }
}

/** The square of the king that is currently in check, or null. */
export function checkedKingSquare(state: GameState): Square | null {
  if (state.status !== "check" && state.status !== "checkmate") return null;
  return kingSquare(state.position, state.position.side);
}

export function matedKingSquare(state: GameState): Square | null {
  return state.status === "checkmate" ? kingSquare(state.position, state.position.side) : null;
}

export function isHumanTurn(state: GameState): boolean {
  return (
    !isGameOver(state.status) && state.position.side === state.humanColor && !state.thinking
  );
}

export { isGameOver, isInCheck };
