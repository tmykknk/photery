import { ImageError } from "../../shared/image-protocol.ts";

interface TicketResponse {
  url: string;
  token: string;
  expiresAt: number;
  fileName: string;
}
interface ImageResult {
  blob: Blob;
  fileName: string;
  route: "worker" | "fallback";
}

async function responseError(response: Response): Promise<ImageError> {
  let code = "image_unavailable";
  try {
    const text = await response.text();
    if (
      response.headers.get("content-type")?.includes("text/html") &&
      /\b1027\b/.test(text)
    )
      return new ImageError("worker_limit", 503);
    const body: unknown = JSON.parse(text);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    )
      code = body.error;
  } catch {
    /* Cloudflare上限時はHTMLエラーになる場合がある。 */
  }
  return new ImageError(code, response.status);
}

function isTicket(value: unknown): value is TicketResponse {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Record<string, unknown>;
  return (
    typeof ticket.url === "string" &&
    typeof ticket.token === "string" &&
    typeof ticket.expiresAt === "number" &&
    typeof ticket.fileName === "string"
  );
}

// この状態はブラウザ内だけで共有し、予備転送予算はサーバーで管理する。
export function createImageClient(
  request: typeof fetch = fetch,
  now = Date.now,
) {
  let active = 0;
  const queue: Array<{ run: () => void; priority: boolean }> = [];
  let failures = 0;
  let fallbackUntil = 0;
  const tickets = new Map<string, TicketResponse>();

  async function acquire(signal: AbortSignal, priority: boolean) {
    signal.throwIfAborted();
    if (active < 4) {
      active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const run = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const index = queue.findIndex((item) => item.run === run);
        if (index >= 0) queue.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      const position = priority
        ? queue.findIndex((item) => !item.priority)
        : -1;
      if (position < 0) queue.push({ run, priority });
      else queue.splice(position, 0, { run, priority });
    });
  }

  function release() {
    const next = queue.shift();
    if (next) next.run();
    else active--;
  }

  async function ticketFor(
    endpoint: string,
    signal: AbortSignal,
  ): Promise<TicketResponse> {
    const cached = tickets.get(endpoint);
    if (cached && cached.expiresAt * 1000 > now() + 10_000) return cached;
    const response = await request(endpoint, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw await responseError(response);
    const value: unknown = await response.json();
    if (!isTicket(value)) throw new ImageError("invalid_ticket_response", 502);
    if (tickets.size >= 256) tickets.delete(tickets.keys().next().value ?? "");
    tickets.set(endpoint, value);
    return value;
  }

  async function fallback(
    endpoint: string,
    signal: AbortSignal,
  ): Promise<ImageResult> {
    const response = await request(`${endpoint}&fallback=1`, {
      credentials: "same-origin",
      signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    });
    if (!response.ok) throw await responseError(response);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/"))
      throw new ImageError("invalid_image", 415);
    return { blob, fileName: "image", route: "fallback" };
  }

  async function load(
    endpoint: string,
    signal: AbortSignal,
    download = false,
    priority = false,
  ): Promise<ImageResult> {
    await acquire(signal, priority);
    try {
      signal.throwIfAborted();
      if (!download && now() < fallbackUntil)
        return await fallback(endpoint, signal);
      for (let attempt = 0; attempt < 2; attempt++) {
        // アプリの認可失敗では配信先を変えない。
        const ticket = await ticketFor(endpoint, signal);
        try {
          const response = await request(ticket.url, {
            headers: { Authorization: `Bearer ${ticket.token}` },
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(download ? 120_000 : 20_000),
            ]),
          });
          if (!response.ok) {
            const error = await responseError(response);
            if (error.code === "ticket_expired" && attempt === 0) {
              tickets.delete(endpoint);
              continue;
            }
            throw error;
          }
          const blob = await response.blob();
          if (!download && !blob.type.startsWith("image/"))
            throw new ImageError("invalid_image", 415);
          failures = 0;
          fallbackUntil = 0;
          return { blob, fileName: ticket.fileName, route: "worker" };
        } catch (error) {
          signal.throwIfAborted();
          if (
            error instanceof ImageError &&
            error.status < 500 &&
            error.status !== 429
          )
            throw error;
          failures++;
          if (failures >= 2) fallbackUntil = now() + 5 * 60_000;
          if (download)
            throw new ImageError("download_temporarily_unavailable", 503);
          return await fallback(endpoint, signal);
        }
      }
      throw new ImageError("ticket_expired", 401);
    } finally {
      release();
    }
  }
  return { load };
}

export const imageClient = createImageClient();
