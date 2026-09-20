import { imageClient } from "./image-client.ts";

const lifetime = 5 * 60_000;
const maxEntries = 24;
const maxBytes = 32 * 1024 * 1024;

interface Entry {
  controller: AbortController;
  promise: Promise<string>;
  consumers: Set<() => void>;
  url: string;
  bytes: number;
  expiresAt: number;
  lastUsed: number;
  timer?: ReturnType<typeof setTimeout>;
  disposed: boolean;
}

// カードとライトボックスで同一の表示画像を使う。
export function displayImageEndpoint(src: string) {
  const url = new URL(src, "http://photery.invalid");
  url.searchParams.set("variant", "lightbox");
  url.searchParams.set("width", "1600");
  url.searchParams.delete("fallback");
  url.searchParams.sort();
  return `${url.pathname}?${url.searchParams}`;
}

export function createDisplayImageCache(
  load: typeof imageClient.load,
  now = Date.now,
  promote: (signal: AbortSignal) => void = () => {},
) {
  const entries = new Map<string, Entry>();
  // 期限切れでも表示中の旧世代は最後の利用者が離れるまで保持する。
  const generations = new Set<Entry>();

  function dispose(entry: Entry) {
    if (entry.disposed) return;
    entry.disposed = true;
    clearTimeout(entry.timer);
    entry.controller.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
    generations.delete(entry);
    for (const [key, current] of entries) {
      if (current === entry) entries.delete(key);
    }
  }

  function prune() {
    const idle = [...generations]
      .filter((entry) => entry.url && entry.consumers.size === 0)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    let bytes = idle.reduce((sum, entry) => sum + entry.bytes, 0);
    let count = idle.length;
    for (const entry of idle) {
      if (entry.expiresAt <= now() || count > maxEntries || bytes > maxBytes) {
        bytes -= entry.bytes;
        count--;
        dispose(entry);
      }
    }
  }

  function scheduleIdle(entry: Entry) {
    clearTimeout(entry.timer);
    if (entry.disposed || entry.consumers.size) return;
    if (!entry.url) {
      entry.timer = setTimeout(() => dispose(entry), 250);
    } else {
      prune();
      if (!entry.disposed) {
        entry.timer = setTimeout(prune, Math.max(0, entry.expiresAt - now()));
      }
    }
  }

  function acquire(src: string, priority: boolean, onInvalidated: () => void) {
    prune();
    const key = displayImageEndpoint(src);
    let entry = entries.get(key);
    if (entry?.url && entry.expiresAt <= now()) entry = undefined;
    if (!entry) {
      const created: Entry = {
        controller: new AbortController(),
        promise: Promise.resolve(""),
        consumers: new Set(),
        url: "",
        bytes: 0,
        expiresAt: 0,
        lastUsed: now(),
        disposed: false,
      };
      entries.set(key, created);
      generations.add(created);
      created.promise = load(key, created.controller.signal, false, priority)
        .then(({ blob }) => {
          created.controller.signal.throwIfAborted();
          created.url = URL.createObjectURL(blob);
          created.bytes = blob.size;
          created.expiresAt = now() + lifetime;
          scheduleIdle(created);
          return created.url;
        })
        .catch((error: unknown) => {
          dispose(created);
          throw error;
        });
      entry = created;
    }
    const current = entry;
    if (priority && !current.url) promote(current.controller.signal);
    clearTimeout(current.timer);
    current.consumers.add(onInvalidated);
    current.lastUsed = now();
    let released = false;
    return {
      promise: current.promise,
      release() {
        if (released) return;
        released = true;
        current.consumers.delete(onInvalidated);
        current.lastUsed = now();
        scheduleIdle(current);
      },
      invalidate() {
        dispose(current);
        for (const notify of current.consumers) notify();
      },
    };
  }

  function clear() {
    for (const entry of [...generations]) {
      dispose(entry);
      for (const notify of entry.consumers) notify();
    }
  }

  return { acquire, clear };
}

export const displayImageCache = createDisplayImageCache(
  imageClient.load,
  Date.now,
  imageClient.promote,
);
imageClient.onAuthorizationFailure(displayImageCache.clear);
