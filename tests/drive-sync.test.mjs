import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import { after, test } from "node:test";

// Next.js のサーバー境界と DB・Cookie だけを置換し、同期処理と認可は実物を使う。
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const emptyModule = stub("export {};");
const storeModule = stub(`
  export const calls = [];
  export let failUpsert = false;
  export function setFailUpsert(value) { failUpsert = value; }
  export async function upsertDriveImages(files) {
    calls.push(["upsert", files]);
    if (failUpsert) throw new Error("test database failure");
  }
  export async function deleteStaleDriveImages(ids) {
    calls.push(["delete", [...ids]]);
    return 0;
  }
`);
const cookiesModule = stub(`
  export const values = new Map();
  export async function cookies() { return { get: name => values.get(name) }; }
`);
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (
      url.startsWith(new URL("../", import.meta.url).href) &&
      url.endsWith(".ts")
    ) {
      return nextLoad(url, { ...context, format: "module-typescript" });
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only")
      return { url: emptyModule, shortCircuit: true };
    if (specifier === "@/app/lib/drive-images/store")
      return { url: storeModule, shortCircuit: true };
    if (specifier === "next/headers")
      return { url: cookiesModule, shortCircuit: true };
    if (specifier === "next/server")
      return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/"))
      return {
        url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});
after(() => hooks.deregister());

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GOOGLE_CLIENT_EMAIL = "test@example.invalid";
process.env.GOOGLE_PRIVATE_KEY = privateKey.export({
  type: "pkcs8",
  format: "pem",
});
process.env.GOOGLE_DRIVE_FOLDER_ID = "folder-a,folder-b";
process.env.VIEW_PASSWORD = "test-viewer";
process.env.ADMIN_PASSWORD = "test-admin";
process.env.SITE_AUTH_SECRET = "test-only-secret";
const { listDriveImagesInFolders } =
  await import("../app/lib/drive-images/google-drive.ts");
const { POST } = await import("../app/api/sync/route.ts");
const { createSiteAuthToken, createSiteAdminToken } =
  await import("../app/lib/auth-token.ts");
const store = await import(storeModule);
const { values: cookies } = await import(cookiesModule);
const viewerToken = await createSiteAuthToken(process.env.VIEW_PASSWORD);
const adminToken = await createSiteAdminToken(process.env.ADMIN_PASSWORD);

// すべての通信をモックし、トークンや秘密鍵をログへ出さない。
function mockDrive(t, pages, options = {}) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.ok(init.signal instanceof AbortSignal);
    if (url.hostname === "oauth2.googleapis.com") {
      assert.equal(init.method, "POST");
      return options.authFailure
        ? new Response(null, { status: 401 })
        : Response.json({ access_token: "test-token" });
    }
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    if (url.pathname.endsWith("/folder-a"))
      return Response.json({ name: " A " });
    if (url.pathname.endsWith("/folder-b")) return Response.json({ name: "B" });
    assert.equal(url.searchParams.get("pageSize"), "1000");
    assert.match(
      url.searchParams.get("q"),
      /mimeType contains 'image\/' and trashed = false/,
    );
    const page = pages.shift();
    assert.notEqual(page, undefined, "unexpected additional Drive request");
    if (page instanceof Error) throw page;
    return page instanceof Response ? page : Response.json(page);
  });
  return requests;
}

function resetSync(t) {
  store.calls.length = 0;
  store.setFailUpsert(false);
  cookies.clear();
  cookies.set("site_auth", { value: viewerToken });
  cookies.set("site_admin", { value: adminToken });
  t.mock.method(console, "error", () => {});
}

test("pages, folder order, duplicate tags, rotation and optional dimensions", async (t) => {
  const requests = mockDrive(t, [
    {
      files: [
        {
          id: "one",
          name: "one.jpg",
          imageMediaMetadata: { width: 600, height: 400, rotation: 1 },
        },
      ],
      nextPageToken: "second",
    },
    { files: [{ id: "two", name: null }] },
    { files: [{ id: "one" }, { id: "three" }] },
  ]);
  const files = await listDriveImagesInFolders(["folder-a", "folder-b"]);
  assert.deepEqual(files, [
    {
      id: "one",
      name: "one.jpg",
      tags: ["A", "B"],
      folderOrder: 0,
      width: 400,
      height: 600,
    },
    {
      id: "two",
      name: null,
      tags: ["A"],
      folderOrder: 0,
      width: null,
      height: null,
    },
    {
      id: "three",
      name: null,
      tags: ["B"],
      folderOrder: 1,
      width: null,
      height: null,
    },
  ]);
  assert.equal(
    requests.filter((url) => url.hostname === "oauth2.googleapis.com").length,
    1,
  );
  assert.equal(requests[3].searchParams.get("pageToken"), "second");
});

test("empty intermediate page continues to the next page", async (t) => {
  mockDrive(t, [
    { files: [], nextPageToken: "next" },
    { files: [{ id: "one" }] },
  ]);
  assert.equal((await listDriveImagesInFolders(["folder-a"])).length, 1);
});

test("successful sync writes the complete list before removing stale metadata", async (t) => {
  resetSync(t);
  mockDrive(t, [{ files: [{ id: "one" }] }, { files: [] }]);
  const response = await POST();
  assert.equal(response.status, 200);
  assert.deepEqual(
    store.calls.map(([action]) => action),
    ["upsert", "delete"],
  );
  assert.deepEqual(store.calls[1][1], ["one"]);
});

test("confirmed empty folders can reconcile stale metadata", async (t) => {
  resetSync(t);
  mockDrive(t, [{ files: [] }, { files: [] }]);
  assert.equal((await POST()).status, 200);
  assert.deepEqual(store.calls[1], ["delete", []]);
});

for (const [name, pages, options] of [
  ["authentication failure", [], { authFailure: true }],
  [
    "HTTP failure after a successful page",
    [
      { files: [{ id: "one" }], nextPageToken: "next" },
      new Response(null, { status: 503 }),
    ],
  ],
  ["timeout", [new DOMException("test timeout", "TimeoutError")]],
  ["network failure", [new TypeError("test network failure")]],
  ["invalid JSON", [new Response("not json")]],
  ["missing file list", [{}]],
  ["invalid file list", [{ files: "invalid" }]],
  ["missing image id", [{ files: [{ name: "missing id" }] }]],
  [
    "invalid dimensions",
    [{ files: [{ id: "one", imageMediaMetadata: { width: "wide" } }] }],
  ],
  ["incomplete search", [{ files: [], incompleteSearch: true }]],
  ["invalid page token", [{ files: [], nextPageToken: 123 }]],
  [
    "repeated page token",
    [
      { files: [], nextPageToken: "again" },
      { files: [], nextPageToken: "again" },
    ],
  ],
]) {
  test(`${name} prevents all database writes and deletions`, async (t) => {
    resetSync(t);
    mockDrive(t, pages, options);
    assert.equal((await POST()).status, 500);
    assert.deepEqual(store.calls, []);
  });
}

test("upsert failure prevents stale deletion", async (t) => {
  resetSync(t);
  store.setFailUpsert(true);
  mockDrive(t, [{ files: [{ id: "one" }] }, { files: [] }]);
  assert.equal((await POST()).status, 500);
  assert.deepEqual(
    store.calls.map(([action]) => action),
    ["upsert"],
  );
});

test("unauthenticated and viewer-only requests do not start syncing", async (t) => {
  resetSync(t);
  const fetchMock = t.mock.method(globalThis, "fetch", () => {
    throw new Error("unexpected request");
  });
  cookies.clear();
  assert.equal((await POST()).status, 401);
  cookies.set("site_auth", { value: viewerToken });
  assert.equal((await POST()).status, 403);
  assert.deepEqual(store.calls, []);
  assert.equal(fetchMock.mock.callCount(), 0);
});
