import { route } from "@/lib/room/api-route.ts";
import { handleResign, readKey } from "@/lib/room/handlers.ts";

/**
 * Gives the game up.
 *
 * The one ending that is not a fact about the board, which is why it needs a route at all:
 * every other outcome is something the engine can work out for itself.
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
        : await handleResign(store, key, body, now),
  });
}
