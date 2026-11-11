import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, test } from "node:test";

// ブラウザ用キャッシュを外部通信なしで検証する。
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (
      url.startsWith(new URL("../", import.meta.url).href) &&
      url.endsWith(".ts")
    )
      return nextLoad(url, { ...context, format: "module-typescript" });
    return nextLoad(url, context);
  },
});
after(() => hooks.deregister());
const { createDisplayImageCache } =
  await import("../app/components/display-image-cache.ts");

function fixture(t, bytes = 16) {
  let time = Date.now();
  let loads = 0;
  const cache = createDisplayImageCache(
    async () => {
      loads++;
      return {
        blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        fileName: "test.png",
        route: "worker",
      };
    },
    () => time++,
  );
  t.after(() => cache.clear());
  return {
    cache,
    loads: () => loads,
    advance: (ms) => {
      time += ms;
    },
  };
}

// 一覧に残る60枚を、未使用キャッシュの上限で追い出さない。
test("mounted gallery images keep the same URLs beyond 24 images and five minutes", async (t) => {
  const f = fixture(t);
  const first = f.cache.acquire("/api/images/0", true, () =>
    assert.fail("active image invalidated"),
  );
  const firstUrl = await first.promise;
  for (let index = 1; index < 60; index++) {
    const lease = f.cache.acquire(`/api/images/${index}`, false, () => {});
    await lease.promise;
  }
  f.advance(5 * 60_000);
  const unrelated = f.cache.acquire("/api/images/new", false, () => {});
  await unrelated.promise;
  assert.equal(await first.promise, firstUrl);
  assert.equal(f.loads(), 61);
  // 後片付け時の認証無効化通知からは外す。
  first.release();
});

test("matching image variants share their in-flight fetch and Blob URL", async (t) => {
  const f = fixture(t);
  const card = f.cache.acquire("/api/images/a", true, () => {});
  const lightbox = f.cache.acquire(
    "/api/images/a?variant=lightbox&width=1600",
    true,
    () => {},
  );
  assert.equal(await card.promise, await lightbox.promise);
  card.release();
  assert.equal(await lightbox.promise, await card.promise);
  assert.equal(f.loads(), 1);
});

test("leaving a gallery releases images down to the 24-image idle limit", async (t) => {
  const f = fixture(t);
  const revoked = t.mock.method(URL, "revokeObjectURL");
  const leases = [];
  for (let index = 0; index < 60; index++) {
    const lease = f.cache.acquire(`/api/images/${index}`, true, () => {});
    await lease.promise;
    leases.push(lease);
  }
  assert.equal(revoked.mock.callCount(), 0);
  for (const lease of leases) lease.release();
  assert.equal(revoked.mock.callCount(), 36);
});

test("idle images remain subject to the 32MiB limit", async (t) => {
  const f = fixture(t, 17 * 1024 * 1024);
  const revoked = t.mock.method(URL, "revokeObjectURL");
  const first = f.cache.acquire("/api/images/a", true, () => {});
  const firstUrl = await first.promise;
  first.release();
  const second = f.cache.acquire("/api/images/b", true, () => {});
  await second.promise;
  second.release();
  assert.ok(
    revoked.mock.calls.some(({ arguments: args }) => args[0] === firstUrl),
  );
});

test("idle images expire after five minutes", async (t) => {
  const f = fixture(t);
  const first = f.cache.acquire("/api/images/a", true, () => {});
  const firstUrl = await first.promise;
  first.release();
  f.advance(5 * 60_000);
  const next = f.cache.acquire("/api/images/a", true, () => {});
  assert.notEqual(await next.promise, firstUrl);
  assert.equal(f.loads(), 2);
});

test("authorization invalidation revokes mounted image URLs and notifies views", async (t) => {
  const f = fixture(t);
  const invalidated = [];
  const revoked = t.mock.method(URL, "revokeObjectURL");
  const first = f.cache.acquire("/api/images/a", true, () =>
    invalidated.push("a"),
  );
  const second = f.cache.acquire("/api/images/a", true, () =>
    invalidated.push("b"),
  );
  const url = await first.promise;
  await second.promise;
  f.cache.clear();
  assert.deepEqual(invalidated, ["a", "b"]);
  assert.ok(revoked.mock.calls.some(({ arguments: args }) => args[0] === url));
});

// 同一Worker URLでも、HTTPキャッシュを介さず同時4件を取得する。
test("Worker requests bypass HTTP cache and retain the four-request limit", async () => {
  const { createImageClient } =
    await import("../app/components/image-client.ts");
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  let active = 0;
  let peak = 0;
  let workerRequests = 0;
  const client = createImageClient(async (input, init) => {
    if (String(input).startsWith("/api/images/")) {
      return Response.json({
        url: "https://worker.invalid/image",
        token: "fixture-ticket",
        expiresAt: Date.now() / 1000 + 300,
        fileName: "fixture.jpg",
      });
    }
    assert.equal(init.cache, "no-store");
    assert.deepEqual(init.headers, { Authorization: "Bearer fixture-ticket" });
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
    active++;
    peak = Math.max(peak, active);
    workerRequests++;
    if (workerRequests === 4) started.resolve();
    await gate.promise;
    active--;
    return new Response("fixture", {
      headers: { "Content-Type": "image/jpeg" },
    });
  });
  const loads = Array.from({ length: 6 }, (_, index) =>
    client.load(
      `/api/images/${index}?width=1600`,
      new AbortController().signal,
    ),
  );
  await started.promise;
  assert.equal(workerRequests, 4);
  gate.resolve();
  await Promise.all(loads);
  assert.equal(peak, 4);
  assert.equal(workerRequests, 6);
});
