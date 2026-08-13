/**
 * What a connected socket is allowed to do, and who hears about it.
 *
 * The hub owns no rules. Every decision about a room comes from `lib/room/service.ts`, and
 * this file decodes a message, calls one function, and publishes the answer. Keeping it
 * that thin is what let the races be tested without a network.
 *
 * Two things here are not in the service, because they are properties of a connection
 * rather than of a room: the heartbeat that keeps a seat looking present, and the sweep
 * that lets a seat stop looking present without anyone doing anything.
 */

import type { WebSocket } from "ws";
import { HEARTBEAT_MS } from "../lib/room/presence.ts";
import type {
  ClientMessage,
  Presence,
  RejectReason,
  RoomSnapshot,
  Seat,
  SeatMap,
  SeatPreference,
  ServerMessage,
} from "../lib/room/protocol.ts";
import { PROTOCOL } from "../lib/room/protocol.ts";
import { createRoom, joinRoom, playMove, rematch } from "../lib/room/service.ts";
import type { RoomStore, Unsubscribe } from "../lib/room/store.ts";
import { RateLimiter } from "./guards.ts";

/** How often presence is recomputed for rooms this process is holding a socket for. */
const SWEEP_MS = 2_000;

/** Generous for a person, and nowhere near enough to be useful as a flood. */
const MESSAGE_LIMIT = 120;
const MOVE_LIMIT = 40;
const LIMIT_WINDOW_MS = 10_000;

interface Session {
  socket: WebSocket;
  key: string | null;
  seat: Seat | null;
  token: string | null;
  off: Unsubscribe | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  alive: boolean;
  messages: RateLimiter;
  moves: RateLimiter;
}

export class Hub {
  private store: RoomStore;
  private sessions = new Set<Session>();
  private sweep: ReturnType<typeof setInterval> | null = null;
  /** The last presence published per room, so an unchanged sweep stays silent. */
  private published = new Map<string, string>();
  private now: () => number;

  constructor(store: RoomStore, options: { now?: () => number } = {}) {
    this.store = store;
    this.now = options.now ?? Date.now;
    this.sweep = setInterval(() => {
      void this.sweepPresence();
    }, SWEEP_MS);
    this.sweep.unref?.();
  }

  get connectionCount(): number {
    return this.sessions.size;
  }

  get roomCount(): number {
    return new Set([...this.sessions].map((s) => s.key).filter((k) => k !== null)).size;
  }

  attach(socket: WebSocket): void {
    const session: Session = {
      socket,
      key: null,
      seat: null,
      token: null,
      off: null,
      heartbeat: null,
      alive: true,
      messages: new RateLimiter(MESSAGE_LIMIT, LIMIT_WINDOW_MS),
      moves: new RateLimiter(MOVE_LIMIT, LIMIT_WINDOW_MS),
    };
    this.sessions.add(session);

    socket.on("pong", () => {
      session.alive = true;
    });
    socket.on("message", (raw: unknown) => {
      void this.receive(session, String(raw));
    });
    socket.on("close", () => {
      void this.detach(session);
    });
    socket.on("error", () => {
      void this.detach(session);
    });
  }

  private send(session: Session, message: ServerMessage): void {
    if (session.socket.readyState !== session.socket.OPEN) return;
    session.socket.send(JSON.stringify(message));
  }

  private reject(
    session: Session,
    reason: RejectReason,
    room: RoomSnapshot | null = null,
  ): void {
    this.send(session, { protocol: PROTOCOL, type: "rejected", reason, room });
  }

  private fail(session: Session, code: string, message: string): void {
    this.send(session, { protocol: PROTOCOL, type: "error", code, message });
  }

  private async receive(session: Session, raw: string): Promise<void> {
    const now = this.now();
    if (!session.messages.allow(now)) {
      this.fail(session, "rate", "Too many messages.");
      session.socket.close(1008, "rate");
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.fail(session, "malformed", "Could not read that.");
      return;
    }
    if (message === null || typeof message !== "object" || typeof message.type !== "string") {
      this.fail(session, "malformed", "Could not read that.");
      return;
    }
    if (message.protocol !== PROTOCOL) {
      // One side has been deployed and the other has not. Saying so is better than acting
      // on a message whose shape is a guess.
      this.fail(session, "protocol", "This page is out of date. Reload to keep playing.");
      session.socket.close(1008, "protocol");
      return;
    }

    try {
      switch (message.type) {
        case "create":
          await this.onCreate(session, message.prefer);
          return;
        case "join":
          await this.onJoin(session, message.key, message.token, message.prefer);
          return;
        case "move":
          await this.onMove(session, message.uci, message.at);
          return;
        case "rematch":
          await this.onRematch(session);
          return;
        case "ping":
          await this.onPing(session);
          return;
        default:
          this.fail(session, "unknown", "Unknown message.");
      }
    } catch (error) {
      // A store that is briefly unreachable must not take the process down, and the player
      // needs to be told rather than left watching a board that has quietly stopped.
      console.error("[hub] failed to handle", message.type, error);
      this.fail(session, "unavailable", "The room is not reachable right now.");
    }
  }

  private async onCreate(session: Session, prefer: SeatPreference | undefined): Promise<void> {
    const now = this.now();
    const result = await createRoom(this.store, {
      now,
      ...(prefer === undefined ? {} : { prefer }),
    });
    if (!result.ok) {
      this.reject(session, "full");
      return;
    }
    await this.seat(session, result.room.key, result.seat, result.token, result.snapshot, true);
  }

  private async onJoin(
    session: Session,
    key: string,
    token: string | undefined,
    prefer: SeatPreference | undefined,
  ): Promise<void> {
    if (typeof key !== "string" || key === "") {
      this.reject(session, "not-found");
      return;
    }
    const result = await joinRoom(this.store, {
      key,
      now: this.now(),
      ...(token === undefined ? {} : { token }),
      ...(prefer === undefined ? {} : { prefer }),
    });
    if (!result.ok) {
      this.reject(session, result.reason);
      return;
    }
    await this.seat(session, key, result.seat, result.token, result.snapshot, result.fresh);
  }

  /** Binds a socket to a seat and starts everything that runs for as long as it holds it. */
  private async seat(
    session: Session,
    key: string,
    seat: Seat,
    token: string,
    snapshot: RoomSnapshot,
    fresh: boolean,
  ): Promise<void> {
    // A socket that joins a second room releases the first, or it would keep a seat warm in
    // a game it has walked away from.
    await this.release(session);

    session.key = key;
    session.seat = seat;
    session.token = token;
    session.off = await this.store.subscribe(key, (message) => {
      this.send(session, message);
    });

    await this.store.touch(key, seat, this.now());
    const presence = await this.store.presence(key, this.now());

    this.send(session, {
      protocol: PROTOCOL,
      type: "joined",
      seat,
      token,
      room: snapshot,
      presence,
    });

    // Everyone else finds out through the store, so it reaches the other player even when
    // they are connected to a different process.
    await this.announce(key, presence);

    /*
     * Taking a seat moves the room's version on, so the player already sitting there has to
     * be told, and a presence message does not carry a version.
     *
     * Without this, the first player's opening move is sent against the version they were
     * given when they created the room, the room has moved past it, and the move is refused
     * as stale. Correctly refused, which is what makes it a bad bug: everything reports
     * working and the game simply will not start.
     */
    if (fresh) {
      await this.store.publish(key, {
        protocol: PROTOCOL,
        type: "moved",
        uci: "",
        room: snapshot,
      });
    }

    session.heartbeat = setInterval(() => {
      if (session.key === null || session.seat === null) return;
      void this.store.touch(session.key, session.seat, this.now()).catch(() => {
        // A missed heartbeat ages into `away` on its own, which is the honest thing for it
        // to do. Nothing here needs to react.
      });
    }, HEARTBEAT_MS);
    session.heartbeat.unref?.();
  }

  private async onMove(session: Session, uci: string, at: number): Promise<void> {
    if (session.key === null || session.token === null) {
      this.reject(session, "not-found");
      return;
    }
    if (!session.moves.allow(this.now())) {
      this.fail(session, "rate", "Too many moves.");
      return;
    }
    if (typeof uci !== "string" || typeof at !== "number") {
      this.reject(session, "illegal");
      return;
    }

    const result = await playMove(this.store, {
      key: session.key,
      token: session.token,
      uci,
      at,
      now: this.now(),
    });

    if (!result.ok) {
      this.reject(session, result.reason, result.snapshot);
      return;
    }
    // Published rather than sent, so the player who moved sees it by the same path as the
    // player who did not. One route means one order of events and no second code path
    // where the two boards could come to differ.
    await this.store.publish(session.key, {
      protocol: PROTOCOL,
      type: "moved",
      uci: result.uci,
      room: result.snapshot,
    });
  }

  private async onRematch(session: Session): Promise<void> {
    if (session.key === null || session.token === null) {
      this.reject(session, "not-found");
      return;
    }
    const result = await rematch(this.store, {
      key: session.key,
      token: session.token,
      now: this.now(),
    });
    if (!result.ok) {
      this.reject(session, result.reason, result.snapshot);
      return;
    }
    await this.store.publish(session.key, {
      protocol: PROTOCOL,
      type: "moved",
      uci: "",
      room: result.snapshot,
    });
  }

  private async onPing(session: Session): Promise<void> {
    if (session.key === null || session.seat === null) return;
    await this.store.touch(session.key, session.seat, this.now());
  }

  private async announce(key: string, presence: SeatMap<Presence>): Promise<void> {
    this.published.set(key, JSON.stringify(presence));
    await this.store.publish(key, { protocol: PROTOCOL, type: "presence", key, presence });
  }

  /**
   * Recomputes presence for every room this process is holding, and says so when it moved.
   *
   * Without this, a seat that goes quiet stays on screen as it was. Nothing else is going
   * to notice: the player who left is by definition not sending anything, and the player
   * still there is only reading. The sweep is the thing that turns silence into a state.
   */
  private async sweepPresence(): Promise<void> {
    const keys = new Set(
      [...this.sessions].map((s) => s.key).filter((k): k is string => k !== null),
    );
    for (const key of this.published.keys()) {
      if (!keys.has(key)) this.published.delete(key);
    }

    for (const key of keys) {
      try {
        const presence = await this.store.presence(key, this.now());
        const encoded = JSON.stringify(presence);
        if (this.published.get(key) === encoded) continue;
        await this.announce(key, presence);
      } catch {
        // The next sweep tries again.
      }
    }
  }

  /** Drops the seat binding without closing the socket. */
  private async release(session: Session): Promise<void> {
    if (session.heartbeat !== null) {
      clearInterval(session.heartbeat);
      session.heartbeat = null;
    }
    const { key, seat, off } = session;
    session.key = null;
    session.seat = null;
    session.token = null;
    session.off = null;
    if (off !== null) await off();

    if (key === null || seat === null) return;

    // Backdated deliberately. Presence is one number, and writing a stale one is how a
    // clean disconnect becomes `away` at once rather than after the heartbeat would have
    // lapsed. It then ages to `gone` on its own, with no second mechanism to keep in step.
    const away = this.now() - HEARTBEAT_MS * 3;
    await this.store.touch(key, seat, away).catch(() => {});
    const presence = await this.store.presence(key, this.now()).catch(() => null);
    if (presence !== null) await this.announce(key, presence).catch(() => {});
  }

  private async detach(session: Session): Promise<void> {
    if (!this.sessions.has(session)) return;
    this.sessions.delete(session);
    await this.release(session).catch(() => {});
  }

  /** Terminates sockets that stopped answering. Called on the server's ping interval. */
  probe(): void {
    for (const session of this.sessions) {
      if (!session.alive) {
        session.socket.terminate();
        continue;
      }
      session.alive = false;
      session.socket.ping();
    }
  }

  async close(): Promise<void> {
    if (this.sweep !== null) clearInterval(this.sweep);
    this.sweep = null;
    for (const session of [...this.sessions]) {
      await this.detach(session);
      session.socket.close(1001, "shutting down");
    }
  }
}
