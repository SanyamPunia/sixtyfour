import { route } from "@/lib/room/api-route.ts";
import { handleLeave, readKey } from "@/lib/room/handlers.ts";

/**
 * Gives up a seat so somebody can use it.
 *
 * Called on leaving, and best-effort as a tab closes, which is why it has to work as a
 * `sendBeacon`: no response is read and there is nothing left to retry with.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  const key = readKey((await context.params).key);
  return route({
    request,
    run: async (store, body, now) =>
      key === null
        ? {
            status: 404,
            body: { protocol: 1, type: "rejected", reason: "not-found", room: null },
          }
        : await handleLeave(store, key, body, now),
  });
}
