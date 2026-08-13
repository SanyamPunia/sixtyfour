import { route } from "@/lib/room/api-route.ts";
import { handlePoll, readKey } from "@/lib/room/handlers.ts";

/**
 * The poll, and the only request a player makes over and over.
 *
 * `force-dynamic` because the answer is different every time it is asked. A cached poll is
 * a board that has stopped moving.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  const key = readKey((await context.params).key);
  const seat = new URL(request.url).searchParams.get("seat");
  return route({
    run: async (store, _body, now) =>
      key === null
        ? {
            status: 404,
            body: { protocol: 1, type: "rejected", reason: "not-found", room: null },
          }
        : await handlePoll(store, key, seat, now),
  });
}
