import { route } from "@/lib/room/api-route.ts";
import { handleMove, readKey } from "@/lib/room/handlers.ts";

/** The one route that changes a board, and the one that trusts nothing it is told. */
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
        : await handleMove(store, key, body, now),
  });
}
