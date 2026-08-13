import { route } from "@/lib/room/api-route.ts";
import { handleRematch, readKey } from "@/lib/room/handlers.ts";

/** Clears the board for another game, once the current one is actually over. */
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
        : await handleRematch(store, key, body, now),
  });
}
