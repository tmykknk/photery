import { base64url, ImageError, type ImageTicket } from "./image-protocol.ts";

export interface DriveCredentials {
  email: string;
  privateKey: string;
}
export type MediaFetch = typeof fetch;

// JSON・予備画像は上限付きで読み、超過時は上流を中止する。
export async function readBounded(
  response: Response,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) throw new ImageError("empty_image", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new ImageError("image_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(
    new TextDecoder().decode(await readBounded(response, 64_000)),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ImageError("invalid_upstream", 502);
  return value as Record<string, unknown>;
}

export async function getDriveAccessToken(
  credentials: DriveCredentials,
  request: MediaFetch = fetch,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));
  const assertion = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: credentials.email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const pem = credentials.privateKey
    .replace(/\\n/g, "\n")
    .replace(/-----[^-]+-----|\s|"/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(assertion),
  );
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${assertion}.${base64url(new Uint8Array(signature))}`,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ImageError("drive_auth_unavailable", 503);
  }
  const token = await readJson(response);
  if (typeof token.access_token !== "string")
    throw new ImageError("drive_auth_unavailable", 503);
  return token.access_token;
}

function allowedThumbnail(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === "443") &&
    (url.hostname === "drive.google.com" ||
      url.hostname.endsWith(".googleusercontent.com"))
  );
}

// リダイレクト先を毎回検証し、認証情報をGoogle以外へ送らない。
async function fetchThumbnail(
  url: URL,
  token: string,
  request: MediaFetch,
  signal: AbortSignal,
): Promise<Response> {
  for (let hop = 0; hop < 4; hop++) {
    if (!allowedThumbnail(url)) throw new ImageError("invalid_upstream", 502);
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new ImageError("invalid_upstream", 502);
    url = new URL(location, url);
  }
  throw new ImageError("invalid_upstream", 502);
}

export async function fetchDriveMedia(
  ticket: Pick<ImageTicket, "fileId" | "width" | "variant">,
  credentials: DriveCredentials,
  request: MediaFetch = fetch,
  signal = AbortSignal.timeout(25_000),
) {
  const token = await getDriveAccessToken(credentials, request);
  const authorization = { Authorization: `Bearer ${token}` };
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ticket.fileId)}`;
  const metadataResponse = await request(
    `${base}?fields=name,mimeType,thumbnailLink,trashed&supportsAllDrives=true`,
    { headers: authorization, signal, redirect: "manual" },
  );
  if (!metadataResponse.ok) {
    await metadataResponse.body?.cancel();
    if (metadataResponse.status >= 500 || metadataResponse.status === 429)
      throw new ImageError("drive_unavailable", 503);
    throw new ImageError(
      metadataResponse.status === 404
        ? "image_not_found"
        : "drive_access_denied",
      metadataResponse.status === 404 ? 404 : 403,
    );
  }
  const metadata = await readJson(metadataResponse);
  if (
    metadata.trashed ||
    typeof metadata.mimeType !== "string" ||
    !metadata.mimeType.startsWith("image/")
  )
    throw new ImageError("image_not_found", 404);
  const fileName = typeof metadata.name === "string" ? metadata.name : "image";
  let response: Response;
  if (ticket.variant === "download") {
    response = await request(`${base}?alt=media&supportsAllDrives=true`, {
      headers: authorization,
      signal,
      redirect: "manual",
    });
  } else {
    if (typeof metadata.thumbnailLink !== "string")
      throw new ImageError("thumbnail_unavailable", 404);
    const original = new URL(metadata.thumbnailLink);
    if (!allowedThumbnail(original))
      throw new ImageError("invalid_upstream", 502);
    const sized = new URL(original);
    if (/=s\d+(?:-[a-z]+)?$/i.test(sized.pathname))
      sized.pathname = sized.pathname.replace(
        /=s\d+(?:-[a-z]+)?$/i,
        `=s${ticket.width}`,
      );
    else sized.searchParams.set("sz", `w${ticket.width}`);
    response = await fetchThumbnail(sized, token, request, signal);
    if (!response.ok && sized.href !== original.href) {
      await response.body?.cancel();
      response = await fetchThumbnail(original, token, request, signal);
    }
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ImageError(
      "drive_image_unavailable",
      response.status === 404 ? 404 : response.status === 403 ? 403 : 503,
    );
  }
  const contentType = (
    response.headers.get("content-type") ?? metadata.mimeType
  )
    .split(";")[0]
    .toLowerCase();
  // SVGやHTMLをアプリのOriginで配信しない。
  if (
    ticket.variant !== "download" &&
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/gif",
    ].includes(contentType)
  ) {
    await response.body?.cancel();
    throw new ImageError("unsupported_image", 415);
  }
  return { response, contentType, fileName };
}

export function contentDisposition(fileName: string): string {
  const safe = fileName.replace(/[\r\n\\"\x00-\x1f]/g, "_");
  return `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
