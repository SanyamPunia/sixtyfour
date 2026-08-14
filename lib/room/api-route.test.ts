/**
 * The two checks that stand between an untrusted request and the room service.
 *
 * Both are exported for this reason. `route()` itself reaches for the live store and cannot
 * run without a connection string, but everything worth attacking happens before it gets
 * there, so that part is tested on its own.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readBody, sameOrigin } from "./api-route.ts";

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("reading a body", () => {
  test("valid json comes back parsed", async () => {
    assert.deepEqual(await readBody(request('{"prefer":"white"}')), { prefer: "white" });
  });

  test("an empty body is an empty object, not a failure", async () => {
    assert.deepEqual(await readBody(request("")), {});
    assert.deepEqual(await readBody(request("   ")), {});
  });

  test("anything that is not json is refused", async () => {
    assert.equal(await readBody(request("not json")), null);
    assert.equal(await readBody(request("{oops")), null);
  });

  test("a body without the json content type is refused", async () => {
    // A cross-site fetch that sets this header earns a preflight, which these routes do
    // not answer, so requiring it is a second lock on the same door as the origin check.
    for (const type of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const r = new Request("http://localhost/api/rooms", {
        method: "POST",
        headers: { "content-type": type },
        body: "{}",
      });
      assert.equal(await readBody(r), null, `${type} was accepted`);
    }
  });

  test("an oversized body is refused", async () => {
    const huge = JSON.stringify({ token: "x".repeat(8000) });
    assert.equal(await readBody(request(huge)), null);
  });

  test("the size is counted as it arrives, not after", async () => {
    /*
     * The point of the limit. A chunked body carries no content-length, so a check that
     * reads first and measures afterwards accepts every byte before deciding, which is
     * exactly what the limit exists to stop. This one never sees the second chunk.
     */
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        if (produced > 40) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024).fill(65));
      },
    });

    const chunked = new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // @ts-expect-error duplex is required for a streaming body and is not in the DOM lib
      duplex: "half",
    });

    assert.equal(await readBody(chunked), null);
    assert.ok(produced < 40, `read ${produced}KB of a 40KB body before giving up`);
  });

  test("a lying content-length is caught by the count anyway", async () => {
    const huge = JSON.stringify({ token: "x".repeat(8000) });
    assert.equal(await readBody(request(huge, { "content-length": "12" })), null);
  });
});

describe("origin", () => {
  test("same-origin and a direct navigation are allowed", () => {
    for (const site of ["same-origin", "none"]) {
      const r = new Request("http://localhost/api/rooms", {
        headers: { "sec-fetch-site": site },
      });
      assert.equal(sameOrigin(r), true, `${site} was refused`);
    }
  });

  test("another site is refused", () => {
    for (const site of ["cross-site", "same-site"]) {
      const r = new Request("http://localhost/api/rooms", {
        headers: { "sec-fetch-site": site },
      });
      assert.equal(sameOrigin(r), false, `${site} was allowed`);
    }
  });

  test("a client that sends no such header is allowed through", () => {
    // The content type is what stops a forged request from a browser. This header is a
    // second lock, and refusing everything without it would lock out non-browser callers
    // for no gain, since there is nothing here to borrow an identity with.
    assert.equal(sameOrigin(new Request("http://localhost/api/rooms")), true);
  });
});
