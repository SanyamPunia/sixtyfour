/**
 * Every transition the game can make.
 *
 * The reducer owns all of it. Components read state and dispatch, and never reach into a
 * position or a piece list themselves.
 */

import { at, clonePosition, kingSquare, startPosition } from "../chess/board.ts";
import { makeMove } from "../chess/make.ts";
import { gameStatus, isGameOver, isInCheck, legalMoves } from "../chess/rules.ts";
import type {
  Color,
  GameStatus,
  Move,
  Position,
  PromotionType,
  Square,
} from "../chess/types.ts";
import { EMPTY, FLAG_CASTLE, WHITE } from "../chess/types.ts";
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
  /**
   * A pawn is on the last rank and the player has not said what it becomes. The move is
   * held here rather than played, because a promotion is one move with four outcomes.
   */
  pendingPromotion: { from: Square; to: Square; options: Move[] } | null;
}

export type GameAction =
  | { type: "select"; square: Square }
  | { type: "grab"; square: Square }
  | { type: "play"; move: Move }
  | { type: "promote"; piece: PromotionType }
  | { type: "cancelPromotion" }
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
    // Read from the position rather than assumed. A fresh game is always playing, but
    // hardcoding it means any position handed in is reported as live even when it is
    // already decided, and the bot then searches a position with no legal moves.
    status: gameStatus(position),
    difficulty,
    history: [],
    castlingRookId: null,
    shakeToken: 0,
    resetToken: 0,
    thinking: false,
    pendingPromotion: null,
  };
}

function targetsFrom(pos: Position, square: Square): Move[] {
  return legalMoves(pos).filter((m) => m.from === square);
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
    pendingPromotion: null,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "select": {
      if (isGameOver(state.status) || state.thinking) return state;
      // The picker owns the board until it is answered.
      if (state.pendingPromotion !== null) return state;

      const { position, selected } = state;
      const target = state.legalTargets.filter((m) => m.to === action.square);
      if (target.length > 0) {
        const first = target[0] as Move;
        // Four moves share this destination, one per piece. Ask instead of guessing.
        if (target.some((m) => m.promo !== 0)) {
          return {
            ...state,
            selected: null,
            legalTargets: [],
            pendingPromotion: { from: first.from, to: action.square, options: target },
          };
        }
        return playMove(state, first);
      }

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

    case "promote": {
      const pending = state.pendingPromotion;
      if (pending === null) return state;
      const chosen = pending.options.find((m) => m.promo === action.piece);
      if (chosen === undefined) return state;
      return playMove(state, chosen);
    }

    case "cancelPromotion":
      return state.pendingPromotion === null ? state : { ...state, pendingPromotion: null };

    case "grab": {
      // Selection without the toggle. `select` deselects when you tap the held piece
      // again, which during a drag would drop the piece you are still holding.
      if (isGameOver(state.status) || state.thinking) return state;
      if (state.pendingPromotion !== null) return state;
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
    !isGameOver(state.status) &&
    state.position.side === state.humanColor &&
    !state.thinking &&
    state.pendingPromotion === null
  );
}

/**
 * The outcome, from the player's point of view, or null while the game is live.
 *
 * The side to move at checkmate is the side that got mated, which is why this reads the
 * position rather than tracking a winner as the game runs.
 */
export function outcome(state: GameState): "win" | "loss" | "draw" | null {
  switch (state.status) {
    case "checkmate":
      return state.position.side === state.humanColor ? "loss" : "win";
    case "stalemate":
    case "draw-fifty-move":
    case "draw-repetition":
    case "draw-insufficient":
      return "draw";
    default:
      return null;
  }
}

export { isGameOver, isInCheck };
