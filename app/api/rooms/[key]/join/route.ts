import { route } from "@/lib/room/api-route.ts";
import { handleJoin, readKey } from "@/lib/room/handlers.ts";

/** Takes a seat, or takes back the one this browser already had. */
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
        : await handleJoin(store, key, body, now),
  });
}
