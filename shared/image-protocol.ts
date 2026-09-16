// VercelとWorkerで認可・サイズ制約を共通化する。
export const ticketLifetime = 300;
export const fallbackImageLimit = 2_000_000;
export const defaultFallbackBudget = 1_000_000_000;
export const imageWidths = [320, 640, 800, 1600] as const;
export type ImageVariant = "card" | "lightbox" | "download";

export interface ImageTicket {
  v: 1;
  aud: "photery-images";
  fileId: string;
  variant: ImageVariant;
  width: number;
  iat: number;
  exp: number;
}

export class ImageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function selectImageWidth(width: number, variant: ImageVariant): number {
  if (variant === "download") return 0;
  const maximum = 1600;
  return (
    imageWidths.find((value) => value >= width && value <= maximum) ?? maximum
  );
}

export function parseImageRequest(url: URL, fileId: string) {
  const variant =
    url.searchParams.get("download") === "1"
      ? "download"
      : (url.searchParams.get("variant") ?? "lightbox");
  const width = Number(
    url.searchParams.get("width") ?? (variant === "card" ? 800 : 1600),
  );
  if (
    !/^[\w-]{1,200}$/.test(fileId) ||
    !["card", "lightbox", "download"].includes(variant) ||
    !Number.isFinite(width) ||
    width <= 0
  ) {
    throw new ImageError("invalid_request", 400);
  }
  const validVariant = variant as ImageVariant;
  return {
    fileId,
    variant: validVariant,
    width: selectImageWidth(width, validVariant),
  };
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  );
}

async function signingKey(secret: string) {
  if (secret.length < 32) throw new ImageError("signing_not_configured", 503);
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signImageTicket(
  ticket: ImageTicket,
  secret: string,
): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(ticket)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyImageTicket(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<ImageTicket> {
  if (token.length > 2048) throw new ImageError("invalid_ticket", 403);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined)
    throw new ImageError("invalid_ticket", 403);
  const key = await signingKey(secret);
  try {
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        decode(signature),
        new TextEncoder().encode(payload),
      ))
    )
      throw new Error();
    const value: unknown = JSON.parse(
      new TextDecoder().decode(decode(payload)),
    );
    if (!isImageTicket(value)) throw new Error();
    if (value.exp <= now) throw new ImageError("ticket_expired", 401);
    if (
      value.iat > now + 30 ||
      value.exp - value.iat > ticketLifetime ||
      value.exp <= value.iat
    )
      throw new Error();
    return value;
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError("invalid_ticket", 403);
  }
}

function isImageTicket(value: unknown): value is ImageTicket {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    t.v === 1 &&
    t.aud === "photery-images" &&
    typeof t.fileId === "string" &&
    /^[\w-]{1,200}$/.test(t.fileId) &&
    ["card", "lightbox", "download"].includes(String(t.variant)) &&
    typeof t.width === "number" &&
    (t.variant === "download"
      ? t.width === 0
      : imageWidths.some((width) => width === t.width)) &&
    Number.isSafeInteger(t.iat) &&
    Number.isSafeInteger(t.exp)
  );
}

export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function imageErrorResponse(
  error: unknown,
  headers: HeadersInit = {},
): Response {
  const failure =
    error instanceof ImageError
      ? error
      : new ImageError("image_unavailable", 503);
  return Response.json(
    { error: failure.code },
    { status: failure.status, headers: { ...privateHeaders, ...headers } },
  );
}
