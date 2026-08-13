import { route } from "@/lib/room/api-route.ts";
import { handleCreate } from "@/lib/room/handlers.ts";

/** Opens a room and seats whoever asked. The only route with no key in its path. */
export async function POST(request: Request): Promise<Response> {
  return route({ request, run: (store, body, now) => handleCreate(store, body, now) });
}
