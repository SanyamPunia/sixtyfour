import { callerOf, route } from "@/lib/room/api-route.ts";
import { handleCreate } from "@/lib/room/handlers.ts";

/**
 * Opens a room and seats whoever asked. The only route with no key in its path, and the
 * only one that consumes a slot, so it is the only one that counts who is asking.
 */
export async function POST(request: Request): Promise<Response> {
  const caller = callerOf(request);
  return route({
    request,
    run: (store, body, now) => handleCreate(store, body, now, caller),
  });
}
