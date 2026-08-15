"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fromUci, toUci } from "@/lib/chess/notation.ts";
import type { Color } from "@/lib/chess/types.ts";
import { BLACK, WHITE } from "@/lib/chess/types.ts";
import type { GameAction, GameState } from "@/lib/game/reducer.ts";
import { isGameOver } from "@/lib/game/reducer.ts";
import { forgetToken, readToken, writeToken } from "@/lib/room/credentials.ts";
import type {
  ApiResponse,
  Presence,
  RejectReason,
  Seat,
  SeatMap,
  SeatPreference,
} from "@/lib/room/protocol.ts";
import { PROTOCOL } from "@/lib/room/protocol.ts";

/** The query parameter a shared link carries. */
export const ROOM_PARAM = "room";

/**
 * How often to ask, and why there are two numbers.
 *
 * Polling is the transport, so this interval is the latency of the whole feature. It is
 * also a request per player per interval, forever, against a store with a quota. The two
 * pull in opposite directions, so the rate follows what is actually being waited for:
 * quickly while the answer can change, slowly while it cannot.
 *
 * Nothing polls at all while the tab is hidden. A backgrounded phone asking every one and a
 * half seconds is the single largest source of requests this could have, and it is asking
 * on behalf of somebody who is not looking.
 */
const POLL_WAITING_MS = 1_500;
const POLL_QUIET_MS = 5_000;

/** Backoff after a failed poll, so an outage does not turn into a retry storm. */
const POLL_RETRY_MS = 4_000;

export type RoomStatus = "idle" | "connecting" | "connected" | "reconnecting" | "refused";

export interface RoomView {
  status: RoomStatus;
  key: string | null;
  seat: Seat | null;
  presence: SeatMap<Presence>;
  /** The other seat, which is the only one worth putting on screen. */
  opponent: Presence;
  /** Set when the room refused us, in words a player can act on. */
  problem: string | null;
  /** A link that drops someone straight into this room. */
  link: string | null;
}

export interface RoomControls {
  create: (prefer: SeatPreference) => void;
  join: (key: string) => void;
  leave: () => void;
  rematch: () => void;
  resign: () => void;
  dismissProblem: () => void;
}

const NOBODY: SeatMap<Presence> = { white: "gone", black: "gone" };

const REFUSALS: Record<RejectReason, string> = {
  "not-found": "No room with that key.",
  full: "That room is full.",
  "no-capacity": "All rooms are busy right now. Try again in a few minutes.",
  "not-your-seat": "This browser is not holding a seat in that room.",
  "not-your-turn": "Not your turn.",
  "game-over": "That game is finished.",
  illegal: "That move is not legal.",
  unavailable: "Rooms are not available right now.",
  stale: "",
};

/**
 * Keeps the address bar honest about which room you are in.
 *
 * The URL is what a reload reads, so it has to say the same thing the interface does. It
 * used to be written only by the person who followed a shared link, which made two separate
 * wrongs: someone who created a room lost it on reload, and someone who left a room was put
 * back into it by one, because the key was still sitting in the address bar.
 *
 * `replaceState` rather than `pushState`. Joining and leaving are not places to go back to.
 */
function writeRoomToUrl(key: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (key === null) url.searchParams.delete(ROOM_PARAM);
  else url.searchParams.set(ROOM_PARAM, key);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function seatColor(seat: Seat): Color {
  return seat === "white" ? WHITE : BLACK;
}

/** The colour that gave up, in the terms the board thinks in. */
function resignedColor(seat: Seat | null): Color | null {
  return seat === null ? null : seatColor(seat);
}

function sameMoves(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((move, i) => move === b[i]);
}

/**
 * Plays the game against a person instead of the bot.
 *
 * The board does not change. A move arriving from the other side is dispatched as the same
 * `play` action the bot uses, so every animation, sound and rule already in place applies
 * without knowing where the move came from.
 *
 * Two rules keep the two boards honest. The server decides, always: a local move is shown
 * at once but is not real until it comes back, and anything the server refuses is undone by
 * replacing the board with the one it sent. And a reload resumes rather than restarts,
 * because the seat is held by a token this tab kept.
 */
export function useRoom(
  state: GameState,
  dispatch: (action: GameAction) => void,
): [RoomView, RoomControls] {
  const [status, setStatus] = useState<RoomStatus>("idle");
  const [key, setKey] = useState<string | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [presence, setPresence] = useState<SeatMap<Presence>>(NOBODY);
  const [problem, setProblem] = useState<string | null>(null);

  const keyRef = useRef<string | null>(null);
  const seatRef = useRef<Seat | null>(null);
  const tokenRef = useRef<string | null>(null);
  const enteredRef = useRef(false);
  /** The moves the server has acknowledged. Anything beyond this is optimistic. */
  const confirmedRef = useRef<string[]>([]);
  const versionRef = useRef(0);
  const sentRef = useRef<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const handle = useCallback((message: ApiResponse): void => {
    if (message.protocol !== PROTOCOL) {
      setProblem("This page is out of date. Reload to keep playing.");
      return;
    }

    switch (message.type) {
      case "joined": {
        keyRef.current = message.room.key;
        seatRef.current = message.seat;
        tokenRef.current = message.token;
        writeToken(message.room.key, message.token);
        writeRoomToUrl(message.room.key);
        confirmedRef.current = [...message.room.moves];
        versionRef.current = message.room.version;
        sentRef.current = null;

        setKey(message.room.key);
        setSeat(message.seat);
        setPresence(message.presence);
        setStatus("connected");
        setProblem(null);

        // The first join sets the seat colour and starts the game. Coming back keeps both
        // and only corrects the board, so a reload does not read as starting over.
        if (enteredRef.current) {
          dispatchRef.current({
            type: "syncRoom",
            moves: [...message.room.moves],
            resigned: resignedColor(message.room.resigned),
          });
        } else {
          enteredRef.current = true;
          dispatchRef.current({
            type: "enterRoom",
            color: seatColor(message.seat),
            moves: [...message.room.moves],
            resigned: resignedColor(message.room.resigned),
          });
        }
        return;
      }

      case "state": {
        setPresence(message.presence);
        setStatus("connected");
        const authoritative = [...message.room.moves];
        // Set before dispatching, not after. The send effect compares the board against
        // this, and if it still held the old list it would take the move that just arrived
        // for a local one and send it straight back.
        confirmedRef.current = authoritative;
        versionRef.current = message.room.version;
        sentRef.current = null;

        const resigned = resignedColor(message.room.resigned);
        const local = stateRef.current.history.map(toUci);
        // A resignation changes no move, so the board would otherwise agree with the server
        // and nothing would be applied. It has to be checked separately from the move list.
        if (sameMoves(local, authoritative) && resigned === stateRef.current.resigned) return;

        // One move ahead of what is on screen, and everything before it agrees. Play it as
        // a move so it animates, rather than rebuilding the board around it.
        if (
          resigned === stateRef.current.resigned &&
          authoritative.length === local.length + 1 &&
          sameMoves(local, authoritative.slice(0, local.length))
        ) {
          const uci = authoritative[authoritative.length - 1] as string;
          const move = fromUci(stateRef.current.position, uci);
          if (move !== null) {
            dispatchRef.current({ type: "play", move });
            return;
          }
        }
        dispatchRef.current({ type: "syncRoom", moves: authoritative, resigned });
        return;
      }

      case "rejected": {
        if (message.room !== null) {
          confirmedRef.current = [...message.room.moves];
          versionRef.current = message.room.version;
          // Whatever this browser believed, the room says otherwise. Taking the room's word
          // for it is the entire reason a refusal carries a board.
          dispatchRef.current({
            type: "syncRoom",
            moves: [...message.room.moves],
            resigned: resignedColor(message.room.resigned),
          });
        }
        sentRef.current = null;

        if (
          message.reason === "not-found" ||
          message.reason === "full" ||
          message.reason === "no-capacity" ||
          message.reason === "unavailable"
        ) {
          setStatus("refused");
          setProblem(REFUSALS[message.reason]);
          // The key in the address bar is why a reload keeps trying a room that will not
          // have us. Refused is as final as leaving, so it goes the same way.
          writeRoomToUrl(null);
          const abandoned = keyRef.current;
          if (abandoned !== null && message.reason !== "unavailable") forgetToken(abandoned);
          keyRef.current = null;
          setKey(null);
          return;
        }
        // A stale move is corrected silently. It means this browser was briefly behind,
        // which is not something the player did and not something they can act on.
        const words = REFUSALS[message.reason];
        if (words !== "") setProblem(words);
        return;
      }

      default:
        return;
    }
  }, []);

  /** One call, one answer, fed through the same handler as everything else. */
  const call = useCallback(
    async (path: string, body: unknown): Promise<boolean> => {
      try {
        const response = await fetch(`/api/rooms${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        handle((await response.json()) as ApiResponse);
        return true;
      } catch {
        setStatus("reconnecting");
        return false;
      }
    },
    [handle],
  );

  const create = useCallback(
    (prefer: SeatPreference) => {
      enteredRef.current = false;
      keyRef.current = null;
      tokenRef.current = null;
      setProblem(null);
      setStatus("connecting");
      void call("", { prefer });
    },
    [call],
  );

  const join = useCallback(
    (roomKey: string) => {
      enteredRef.current = false;
      keyRef.current = roomKey;
      const token = readToken(roomKey);
      tokenRef.current = token;
      setProblem(null);
      setStatus("connecting");
      void call(`/${roomKey}/join`, token === null ? {} : { token });
    },
    [call],
  );

  const leave = useCallback(() => {
    // Told to the server first, while the token is still to hand. Without this the seat
    // stays claimed and the room reports itself full to the two people entitled to it.
    const roomKey = keyRef.current;
    const token = tokenRef.current;
    if (roomKey !== null && token !== null) {
      writeRoomToUrl(null);
      void fetch(`/api/rooms/${roomKey}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        keepalive: true,
      }).catch(() => {
        // The abandonment window in the service is the backstop. Nothing to retry with.
      });
      forgetToken(roomKey);
    }

    keyRef.current = null;
    seatRef.current = null;
    tokenRef.current = null;
    enteredRef.current = false;
    confirmedRef.current = [];
    versionRef.current = 0;
    setKey(null);
    setSeat(null);
    setPresence(NOBODY);
    setProblem(null);
    setStatus("idle");
    dispatchRef.current({ type: "leaveRoom" });
  }, []);

  const resign = useCallback(() => {
    const roomKey = keyRef.current;
    const token = tokenRef.current;
    if (roomKey === null || token === null) return;
    void call(`/${roomKey}/resign`, { token });
  }, [call]);

  const rematch = useCallback(() => {
    const roomKey = keyRef.current;
    const token = tokenRef.current;
    if (roomKey === null || token === null) return;
    void call(`/${roomKey}/rematch`, { token });
  }, [call]);

  /**
   * Sends a move the moment the board shows one, and only if this seat made it.
   *
   * The board is already ahead of the server here: the player moved, it animated, and the
   * server has not seen it. That is deliberate. Waiting for a round trip before moving a
   * piece would put the network in the middle of the one interaction that has to feel
   * immediate, and on this transport that round trip is the slow one.
   */
  useEffect(() => {
    if (state.opponent !== "room") return;
    const mySeat = seatRef.current;
    const roomKey = keyRef.current;
    const token = tokenRef.current;
    if (mySeat === null || token === null || roomKey === null) return;

    const local = state.history.map(toUci);
    const confirmed = confirmedRef.current;
    if (local.length !== confirmed.length + 1) return;
    if (!sameMoves(confirmed, local.slice(0, confirmed.length))) return;

    const last = state.history[state.history.length - 1];
    if (last === undefined) return;
    // The opponent's move also grows this list, and sending it back would be a loop.
    if (Math.sign(last.piece) !== seatColor(mySeat)) return;

    const uci = toUci(last);
    if (sentRef.current === uci) return;
    sentRef.current = uci;
    void call(`/${roomKey}/move`, { token, uci, at: versionRef.current });
  }, [state.history, state.opponent, call]);

  /**
   * The loop. Says we are still here, then asks what changed.
   *
   * Rescheduled after each answer rather than run on a fixed interval, so a slow response
   * cannot stack requests on top of each other, and so the gap can change with what is
   * being waited for.
   */
  const waitingOnThem =
    seat !== null &&
    (presence[seat === "white" ? "black" : "white"] !== "here" ||
      (!isGameOver(state.status) && state.position.side !== state.humanColor));

  useEffect(() => {
    if (key === null || seat === null || status === "refused") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      if (stopped) return;
      if (document.visibilityState !== "visible") {
        // Nothing is being read, so nothing needs asking. Presence going stale while a tab
        // is hidden is not a bug, it is the truthful answer.
        timer = setTimeout(() => void tick(), POLL_QUIET_MS);
        return;
      }
      let delay = waitingOnThem ? POLL_WAITING_MS : POLL_QUIET_MS;
      try {
        const response = await fetch(`/api/rooms/${key}?seat=${seat}`, {
          cache: "no-store",
        });
        if (stopped) return;
        handle((await response.json()) as ApiResponse);
      } catch {
        if (!stopped) setStatus("reconnecting");
        delay = POLL_RETRY_MS;
      }
      if (!stopped) timer = setTimeout(() => void tick(), delay);
    };

    void tick();
    const onVisible = () => {
      // Back on screen. Ask now rather than waiting out whatever gap was in flight.
      if (document.visibilityState !== "visible") return;
      if (timer !== null) clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, seat, status, waitingOnThem, handle]);

  /**
   * A shared link lands here. Joining on arrival is the whole point of the link.
   *
   * Guarded rather than left to the dependency list. `join` is rebuilt whenever anything it
   * closes over changes, and re-running this would start a second join for the same room.
   */
  const linkFollowed = useRef(false);
  useEffect(() => {
    if (linkFollowed.current) return;
    const fromLink = new URLSearchParams(window.location.search).get(ROOM_PARAM);
    if (fromLink === null || fromLink === "") return;
    linkFollowed.current = true;
    joinRef.current(fromLink.toUpperCase());
    // The key stays in the address bar while seated, written by `joined` above, so a reload
    // rejoins. `leave` and a refusal both clear it.
  }, []);

  // Held so the link effect can run once and still reach the current `join`.
  const joinRef = useRef(join);
  joinRef.current = join;

  /**
   * Releases the seat as the tab goes away.
   *
   * `pagehide` rather than `beforeunload`, because a phone backgrounding a tab fires the
   * former and may kill the page without ever firing the latter. `sendBeacon` because a
   * normal fetch is cancelled the moment the document goes, and nothing here reads a reply.
   *
   * Best effort by nature, so it is not the only defence. A seat nobody has answered from
   * is reclaimable anyway, and that is what covers a crash or a lost connection.
   */
  useEffect(() => {
    const release = () => {
      const roomKey = keyRef.current;
      const token = tokenRef.current;
      if (roomKey === null || token === null) return;
      const body = new Blob([JSON.stringify({ token })], { type: "application/json" });
      navigator.sendBeacon?.(`/api/rooms/${roomKey}/leave`, body);
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, []);

  const other: Presence =
    seat === null ? "gone" : presence[seat === "white" ? "black" : "white"];

  return [
    {
      status,
      key,
      seat,
      presence,
      opponent: other,
      problem,
      // Guarded because this runs while rendering, which also happens on the server.
      link:
        key === null || typeof window === "undefined"
          ? null
          : `${window.location.origin}/?${ROOM_PARAM}=${key}`,
    },
    { create, join, leave, rematch, resign, dismissProblem: () => setProblem(null) },
  ];
}
