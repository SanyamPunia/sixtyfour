/**
 * Every transition the game can make.
 *
 * The reducer owns all of it. Components read state and dispatch, and never reach into a
 * position or a piece list themselves.
 */

import { at, clonePosition, kingSquare, startPosition } from "../chess/board.ts";
import { makeMove } from "../chess/make.ts";
import { fromUci } from "../chess/notation.ts";
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

/**
 * Who is on the other side.
 *
 * This is the only thing the reducer knows about rooms, and it exists so that exactly one
 * of the two opponent hooks is live at a time. Everything else about a room stays in
 * `use-room`, which dispatches the same `play` action the bot does. A move is a move.
 */
export type Opponent = "bot" | "room";

export interface GameState {
  position: Position;
  pieces: PieceView[];
  opponent: Opponent;
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
  /**
   * The colour that gave up, or null.
   *
   * Held beside `status` rather than inside it. Every other ending is something
   * `lib/chess` works out by looking at the pieces, and no arrangement of pieces says
   * that somebody decided they had lost, so this is the one outcome the board is told
   * about rather than deriving.
   */
  resigned: Color | null;
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
  | { type: "newGame" }
  | { type: "setSide"; color: Color }
  | { type: "enterRoom"; color: Color; moves: string[]; resigned: Color | null }
  | { type: "syncRoom"; moves: string[]; resigned: Color | null }
  | { type: "leaveRoom" };

export function createGame(
  difficulty: Difficulty = "medium",
  humanColor: Color = WHITE,
  opponent: Opponent = "bot",
): GameState {
  const position = startPosition();
  return {
    position,
    pieces: initialPieces(position),
    opponent,
    humanColor,
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
    resigned: null,
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

/**
 * Rebuilds a game from a move list that is known to be right.
 *
 * Used when the server and this browser have come to disagree, which happens after a
 * reconnect or a refused move. Replaying from the start rather than patching means there is
 * no partial-update path that could leave the board in a state neither side intended.
 *
 * The piece ids come out identical to the ids the same moves would have produced one at a
 * time, because both start from the same scan of the same start position. So React keeps
 * every node, and a correction that agrees with what is on screen is invisible while one
 * that does not slides the affected pieces into place. A resync does not flash the board.
 *
 * A move that will not decode ends the replay. That can only mean a corrupt list, and
 * stopping at the last coherent position beats rendering nonsense.
 */
function fromMoves(base: GameState, moves: readonly string[]): GameState {
  const position = startPosition();
  let pieces = initialPieces(position);
  const history: Move[] = [];
  let lastMove: { from: Square; to: Square } | null = null;

  for (const uci of moves) {
    const move = fromUci(position, uci);
    if (move === null) break;
    const mover = position.side;
    makeMove(position, move);
    pieces = applyMoveToPieces(pieces, move, mover);
    history.push(move);
    lastMove = { from: move.from, to: move.to };
  }

  return {
    ...base,
    position,
    pieces,
    selected: null,
    legalTargets: [],
    lastMove,
    status: gameStatus(position),
    history,
    castlingRookId: null,
    thinking: false,
    pendingPromotion: null,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "select": {
      /*
       * A tap is ignored while it is not your move.
       *
       * `isHumanTurn` is the same question the board asks before it draws a cursor or
       * starts a drag, so the two agree. Ownership below was read as "belongs to the side
       * to move", which matches your own pieces on your move and your opponent's on theirs.
       * Against the bot the thinking flag hid that. A room sets no thinking flag, so the
       * other player's pieces picked up and showed their legal moves.
       *
       * This also covers the promotion picker, which owns the board until it is answered.
       */
      if (!isHumanTurn(state)) return state;

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
      const ownPiece = piece !== EMPTY && Math.sign(piece) === state.humanColor;

      if (!ownPiece) {
        // With nothing held, tapping empty space or one of theirs is a no-op. With a
        // piece held, the tap asked for a move that is not available, and the shake says
        // so without any copy. The selection survives, because otherwise there is nothing
        // left to shake.
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
      if (!isHumanTurn(state)) return state;
      if (state.selected === action.square) return state;
      const piece = at(state.position.board, action.square);
      if (piece === EMPTY || Math.sign(piece) !== state.humanColor) return state;
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
      // In a room, starting again is the other player's decision too, so it goes through
      // the server as a rematch. Clearing the board here would only desync it.
      if (state.opponent === "room") return state;
      // The piece ids come from scanning the start position, so they are the same ids the
      // board is already showing. React keeps those nodes, and every surviving piece
      // transitions home instead of popping there.
      return {
        ...createGame(state.difficulty, state.humanColor),
        resetToken: state.resetToken + 1,
      };

    case "setSide":
      // In a room your colour is your seat, and the seat was decided when you took it.
      if (state.opponent === "room") return state;
      // Changing sides is starting again. There is no meaningful way to swap colours
      // halfway through a game.
      return state.humanColor === action.color
        ? state
        : {
            ...createGame(state.difficulty, action.color),
            resetToken: state.resetToken + 1,
          };

    case "enterRoom":
      return {
        ...fromMoves(createGame(state.difficulty, action.color, "room"), action.moves),
        resigned: action.resigned,
        resetToken: state.resetToken + 1,
      };

    case "syncRoom":
      // Ignored outside a room. A late message from a connection that has since been left
      // must not reach in and rewrite a local game.
      return state.opponent === "room"
        ? { ...fromMoves(state, action.moves), resigned: action.resigned }
        : state;

    case "leaveRoom":
      return {
        ...createGame(state.difficulty, state.humanColor, "bot"),
        resetToken: state.resetToken + 1,
      };

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
    !isOver(state) &&
    state.position.side === state.humanColor &&
    !state.thinking &&
    state.pendingPromotion === null
  );
}

/**
 * What to put on screen when a game ends, or null while it is live.
 *
 * A draw has four causes and they are not interchangeable. Showing "draw" for all of them
 * leaves a player who has just stalemated a lone king with no idea what happened, which is
 * the single most surprising way a won game ends.
 */
/** Over on the board, or over because somebody gave it up. */
export function isOver(state: GameState): boolean {
  return state.resigned !== null || isGameOver(state.status);
}

export function resultLabel(state: GameState): string | null {
  /*
   * Named before the board is consulted. A resignation can happen in any position, and the
   * position it happened in usually has nothing to say.
   *
   * The winner is told how they won, not only that they did. A board that simply stops and
   * says "you win" with the pieces still even is the one ending a player cannot explain to
   * themselves, and it is indistinguishable from a bug.
   */
  if (state.resigned !== null) {
    return state.resigned === state.humanColor ? "you resigned" : "you win, they resigned";
  }
  const yourTurn = state.position.side === state.humanColor;
  switch (state.status) {
    case "checkmate":
      return yourTurn ? "you lose" : "you win";
    case "stalemate":
      return "stalemate";
    case "draw-fifty-move":
      return "draw, fifty moves";
    case "draw-repetition":
      return "draw, repetition";
    case "draw-insufficient":
      return "draw, no mate possible";
    default:
      return null;
  }
}

/**
 * The outcome, from the player's point of view, or null while the game is live.
 *
 * The side to move at checkmate is the side that got mated, which is why this reads the
 * position rather than tracking a winner as the game runs.
 */
export function outcome(state: GameState): "win" | "loss" | "draw" | null {
  if (state.resigned !== null) {
    return state.resigned === state.humanColor ? "loss" : "win";
  }
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
