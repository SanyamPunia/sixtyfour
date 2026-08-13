"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fromUci, toUci } from "@/lib/chess/notation.ts";
import type { Color } from "@/lib/chess/types.ts";
import { BLACK, WHITE } from "@/lib/chess/types.ts";
import type { GameAction, GameState } from "@/lib/game/reducer.ts";
import { forgetToken, readToken, writeToken } from "@/lib/room/credentials.ts";
import type {
  Presence,
  RejectReason,
  Seat,
  SeatMap,
  SeatPreference,
  ServerMessage,
} from "@/lib/room/protocol.ts";
import { PROTOCOL } from "@/lib/room/protocol.ts";

const SERVER = process.env.NEXT_PUBLIC_ROOM_SERVER ?? "";

/** The query parameter a shared link carries. */
export const ROOM_PARAM = "room";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;

/**
 * Failed socket attempts before giving up on sockets entirely.
 *
 * Three, because the first two are indistinguishable from an ordinary blip and switching
 * transports over one of those would make a brief hiccup permanently degrade the game.
 */
const ATTEMPTS_BEFORE_POLLING = 3;

/** Keeps a seat warm without waiting on the server's own bookkeeping. */
const CLIENT_PING_MS = 9_000;

/**
 * How often the fallback asks.
 *
 * This is the number that makes polling the fallback and not the transport. A move can take
 * this long to appear, in a product where a piece slides in 190ms. Faster would cost the
 * server a request per player per fraction of a second for a game that is idle most of the
 * time, which is the trade the socket exists to avoid making.
 */
const POLL_MS = 1_500;

export type RoomStatus =
  | "off"
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "refused";

export type RoomTransport = "socket" | "poll";

export interface RoomView {
  status: RoomStatus;
  transport: RoomTransport;
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
  dismissProblem: () => void;
}

interface Outgoing {
  type: "create" | "join" | "move" | "rematch" | "ping";
  key?: string;
  token?: string;
  uci?: string;
  at?: number;
  prefer?: SeatPreference;
}

const NOBODY: SeatMap<Presence> = { white: "gone", black: "gone" };

const REFUSALS: Record<RejectReason, string> = {
  "not-found": "No room with that key.",
  full: "That room is full.",
  "not-your-seat": "This browser is not holding a seat in that room.",
  "not-your-turn": "Not your turn.",
  "game-over": "That game is finished.",
  illegal: "That move is not legal.",
  stale: "",
};

function seatColor(seat: Seat): Color {
  return seat === "white" ? WHITE : BLACK;
}

function sameMoves(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((move, i) => move === b[i]);
}

/** `ws` and `wss` map onto `http` and `https` on the same host and port. */
function httpBase(): string {
  return SERVER.replace(/^ws/, "http").replace(/\/+$/, "");
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
 * replacing the board with the one it sent. And a reconnect resumes rather than restarts,
 * because the seat is held by a token this tab kept.
 *
 * There are two transports and one of everything else. A socket is what this should be
 * using, and polling is what it falls back to when a network will not carry one. Both feed
 * the same handler with the same messages, so nothing downstream knows which is in use.
 */
export function useRoom(
  state: GameState,
  dispatch: (action: GameAction) => void,
): [RoomView, RoomControls] {
  const [status, setStatus] = useState<RoomStatus>(SERVER === "" ? "off" : "idle");
  const [transport, setTransport] = useState<RoomTransport>("socket");
  const [key, setKey] = useState<string | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [presence, setPresence] = useState<SeatMap<Presence>>(NOBODY);
  const [problem, setProblem] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const keyRef = useRef<string | null>(null);
  const seatRef = useRef<Seat | null>(null);
  const tokenRef = useRef<string | null>(null);
  const enteredRef = useRef(false);
  /** Deliberately left, so the reconnect loop must not fight it. */
  const leftRef = useRef(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The moves the server has acknowledged. Anything beyond this is optimistic. */
  const confirmedRef = useRef<string[]>([]);
  const versionRef = useRef(0);
  const sentRef = useRef<string | null>(null);
  const preferRef = useRef<SeatPreference>("random");
  const intentRef = useRef<"create" | "join">("join");
  const transportRef = useRef<RoomTransport>("socket");

  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  /*
   * Read through a ref, never from the closure.
   *
   * `connect` is reached by `join`, which is reached by the effect that follows a shared
   * link. If `connect` closed over `status` it would be a new function every time the
   * status changed, so that effect would run again on connecting, and again on connected,
   * and each run would close the socket it had just opened. The symptom is a game that
   * looks connected while its opponent flickers in and out.
   */
  const statusRef = useRef(status);
  statusRef.current = status;

  const handle = useCallback((message: ServerMessage): void => {
    switch (message.type) {
      case "joined": {
        keyRef.current = message.room.key;
        seatRef.current = message.seat;
        tokenRef.current = message.token;
        writeToken(message.room.key, message.token);
        confirmedRef.current = [...message.room.moves];
        versionRef.current = message.room.version;
        sentRef.current = null;

        setKey(message.room.key);
        setSeat(message.seat);
        setPresence(message.presence);
        setStatus("connected");
        setProblem(null);
        attemptRef.current = 0;

        // The first join sets the seat colour and starts the game. A reconnect keeps both
        // and only corrects the board, so coming back does not read as starting over.
        if (enteredRef.current) {
          dispatchRef.current({ type: "syncRoom", moves: [...message.room.moves] });
        } else {
          enteredRef.current = true;
          dispatchRef.current({
            type: "enterRoom",
            color: seatColor(message.seat),
            moves: [...message.room.moves],
          });
        }
        return;
      }

      case "moved": {
        const authoritative = [...message.room.moves];
        // Set before dispatching, not after. The send effect compares the board against
        // this, and if it still held the old list it would take the move that just arrived
        // for a local one and send it straight back.
        confirmedRef.current = authoritative;
        versionRef.current = message.room.version;
        sentRef.current = null;

        const local = stateRef.current.history.map(toUci);
        if (sameMoves(local, authoritative)) return;

        // One move ahead of what is on screen, and everything before it agrees. Play it as
        // a move so it animates, rather than rebuilding the board around it.
        if (
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
        dispatchRef.current({ type: "syncRoom", moves: authoritative });
        return;
      }

      case "presence":
        setPresence(message.presence);
        return;

      case "rejected": {
        if (message.room !== null) {
          confirmedRef.current = [...message.room.moves];
          versionRef.current = message.room.version;
          // Whatever this browser believed, the room says otherwise. Taking the room's word
          // for it is the entire reason a refusal carries a board.
          dispatchRef.current({ type: "syncRoom", moves: [...message.room.moves] });
        }
        sentRef.current = null;

        if (message.reason === "not-found" || message.reason === "full") {
          leftRef.current = true;
          setStatus("refused");
          setProblem(REFUSALS[message.reason]);
          const abandoned = keyRef.current;
          if (abandoned !== null) forgetToken(abandoned);
          socketRef.current?.close();
          return;
        }
        // A stale move is corrected silently. It means this browser was briefly behind,
        // which is not something the player did and not something they can act on.
        const words = REFUSALS[message.reason];
        if (words !== "") setProblem(words);
        return;
      }

      case "error":
        setProblem(message.message);
        return;

      default:
        return;
    }
  }, []);

  /** The fallback's version of sending, one request per message. */
  const post = useCallback(
    async (message: Outgoing): Promise<void> => {
      const base = httpBase();
      const roomKey = message.key ?? keyRef.current;
      let url: string;
      let body: Record<string, unknown>;

      switch (message.type) {
        case "create":
          url = `${base}/rooms`;
          body = { prefer: message.prefer ?? "random" };
          break;
        case "join":
          if (roomKey === null) return;
          url = `${base}/rooms/${roomKey}/join`;
          body = { token: message.token, prefer: message.prefer };
          break;
        case "move":
          if (roomKey === null) return;
          url = `${base}/rooms/${roomKey}/move`;
          body = { token: message.token, uci: message.uci, at: message.at };
          break;
        case "rematch":
          if (roomKey === null) return;
          url = `${base}/rooms/${roomKey}/rematch`;
          body = { token: message.token };
          break;
        default:
          // The poll is this transport's heartbeat, so a ping has nothing to do.
          return;
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as ServerMessage & { room?: unknown };
        if (typeof payload === "object" && payload !== null && "type" in payload) {
          handle(payload);
        }
      } catch {
        setProblem("Could not reach the room server.");
      }
    },
    [handle],
  );

  const send = useCallback(
    (message: Outgoing): void => {
      if (transportRef.current === "poll") {
        void post(message);
        return;
      }
      const socket = socketRef.current;
      if (socket === null || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ protocol: PROTOCOL, ...message }));
    },
    [post],
  );

  /** Says why this connection is here, whichever way it got here. */
  const announceIntent = useCallback((): void => {
    const existing = keyRef.current;
    if (intentRef.current === "create" && existing === null) {
      send({ type: "create", prefer: preferRef.current });
      return;
    }
    if (existing === null) return;
    const token = tokenRef.current ?? readToken(existing);
    send({ type: "join", key: existing, ...(token === null ? {} : { token }) });
  }, [send]);

  /** Gives up on sockets and starts asking instead. */
  const fallBackToPolling = useCallback((): void => {
    if (transportRef.current === "poll") return;
    transportRef.current = "poll";
    setTransport("poll");
    setStatus("connecting");
    announceIntent();
  }, [announceIntent]);

  /** Opens a socket and, once it is up, says why it is there. */
  const connect = useCallback(() => {
    if (SERVER === "") return;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (transportRef.current === "poll") {
      announceIntent();
      return;
    }
    if (typeof WebSocket === "undefined") {
      fallBackToPolling();
      return;
    }
    socketRef.current?.close();

    setStatus(attemptRef.current === 0 ? "connecting" : "reconnecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(SERVER);
    } catch {
      fallBackToPolling();
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      announceIntent();
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.protocol !== PROTOCOL) {
        setProblem("This page is out of date. Reload to keep playing.");
        return;
      }
      handle(message);
    };

    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (leftRef.current) return;

      const attempt = attemptRef.current++;
      // Never established, several times over. This is a network that will not carry a
      // socket rather than one that dropped it, so stop trying to open one.
      if (statusRef.current !== "connected" && attempt + 1 >= ATTEMPTS_BEFORE_POLLING) {
        fallBackToPolling();
        return;
      }
      // Exponential, with jitter so two players who dropped together do not come back in
      // lockstep and land on the server at the same instant, over and over.
      const wait = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      setStatus("reconnecting");
      timerRef.current = setTimeout(connect, wait * (0.7 + Math.random() * 0.6));
    };

    socket.onerror = () => {
      // `onclose` always follows, and that is where the retry lives.
    };
  }, [announceIntent, fallBackToPolling, handle]);

  const create = useCallback(
    (prefer: SeatPreference) => {
      leftRef.current = false;
      enteredRef.current = false;
      keyRef.current = null;
      tokenRef.current = null;
      attemptRef.current = 0;
      preferRef.current = prefer;
      intentRef.current = "create";
      setProblem(null);
      connect();
    },
    [connect],
  );

  const join = useCallback(
    (roomKey: string) => {
      leftRef.current = false;
      enteredRef.current = false;
      keyRef.current = roomKey;
      tokenRef.current = readToken(roomKey);
      attemptRef.current = 0;
      intentRef.current = "join";
      setProblem(null);
      connect();
    },
    [connect],
  );

  // Held so the link effect can run once and still reach the current `join`.
  const joinRef = useRef(join);
  joinRef.current = join;

  const leave = useCallback(() => {
    leftRef.current = true;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
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
    setStatus(SERVER === "" ? "off" : "idle");
    dispatchRef.current({ type: "leaveRoom" });
  }, []);

  const rematch = useCallback(() => {
    const roomKey = keyRef.current;
    const token = tokenRef.current;
    if (roomKey === null || token === null) return;
    send({ type: "rematch", key: roomKey, token });
  }, [send]);

  /**
   * Sends a move the moment the board shows one, and only if this seat made it.
   *
   * The board is already ahead of the server here: the player moved, it animated, and the
   * server has not seen it. That is deliberate. Waiting for a round trip before moving a
   * piece would put the network in the middle of the one interaction that has to feel
   * immediate. Being wrong is handled instead of being prevented, by `rejected`.
   */
  useEffect(() => {
    if (state.opponent !== "room") return;
    const mySeat = seatRef.current;
    if (mySeat === null || tokenRef.current === null || keyRef.current === null) return;

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
    send({
      type: "move",
      key: keyRef.current,
      token: tokenRef.current,
      uci,
      at: versionRef.current,
    });
  }, [state.history, state.opponent, send]);

  /** Keeps the seat looking occupied while a game sits idle. */
  useEffect(() => {
    if (status !== "connected" || transport !== "socket") return;
    const timer = setInterval(() => {
      const roomKey = keyRef.current;
      const token = tokenRef.current;
      if (roomKey !== null && token !== null) send({ type: "ping", key: roomKey, token });
    }, CLIENT_PING_MS);
    return () => clearInterval(timer);
  }, [status, transport, send]);

  /** The fallback's whole loop: ask what changed, and say we are still here while asking. */
  useEffect(() => {
    if (transport !== "poll" || key === null || seat === null) return;
    let stopped = false;

    const tick = async (): Promise<void> => {
      try {
        const response = await fetch(`${httpBase()}/rooms/${key}?seat=${seat}`);
        if (stopped) return;
        const payload = (await response.json()) as {
          room?: { version: number; moves: string[]; key: string; taken: SeatMap<boolean> };
          presence?: SeatMap<Presence>;
          type?: string;
        };
        if (stopped) return;
        if (payload.type === "rejected") {
          handle(payload as unknown as ServerMessage);
          return;
        }
        if (payload.presence !== undefined) setPresence(payload.presence);
        if (payload.room !== undefined && payload.room.version !== versionRef.current) {
          handle({
            protocol: PROTOCOL,
            type: "moved",
            uci: "",
            room: payload.room as never,
          });
        }
        setStatus("connected");
      } catch {
        if (!stopped) setStatus("reconnecting");
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [transport, key, seat, handle]);

  /**
   * Reconnects when the tab comes back.
   *
   * A backgrounded tab on a phone gets its socket closed without the page being told in any
   * useful timeframe, so the game looks connected and is not. Checking on the way back is
   * cheap and covers the case people actually hit.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (leftRef.current || keyRef.current === null) return;
      if (transportRef.current === "poll") return;
      const socket = socketRef.current;
      if (socket !== null && socket.readyState === WebSocket.OPEN) return;
      attemptRef.current = 0;
      connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [connect]);

  /**
   * A shared link lands here. Joining on arrival is the whole point of the link.
   *
   * Guarded rather than left to the dependency list. `join` is rebuilt whenever anything it
   * closes over changes, and re-running this would tear down a working connection to open
   * the same one again.
   */
  const linkFollowed = useRef(false);
  useEffect(() => {
    if (SERVER === "" || linkFollowed.current) return;
    const fromLink = new URLSearchParams(window.location.search).get(ROOM_PARAM);
    if (fromLink === null || fromLink === "") return;
    linkFollowed.current = true;
    joinRef.current(fromLink.toUpperCase());
    // The key is left in the address bar deliberately, so a reload rejoins the same room.
  }, []);

  useEffect(() => {
    return () => {
      leftRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  const other: Presence =
    seat === null ? "gone" : presence[seat === "white" ? "black" : "white"];

  return [
    {
      status,
      transport,
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
    { create, join, leave, rematch, dismissProblem: () => setProblem(null) },
  ];
}
