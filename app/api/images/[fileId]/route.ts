import { isValidSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import {
  createDriveAuth,
  createDriveClient,
} from "@/app/lib/drive-images/google-drive";
import {
  bufferToArrayBuffer,
  convertHeicToWebp,
  isHeicImage,
} from "@/app/lib/drive-images/heic";
import { getSyncedDriveImage } from "@/app/lib/drive-images/store";
import { fetchDriveThumbnail } from "@/app/lib/drive-images/thumbnail";
import { cookies } from "next/headers";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    fileId: string;
  }>;
}

function getHeaderValue(
  headers: Headers | Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(key);
  }

  const value = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function createWebpResponse(webpBuffer: Buffer): Response {
  return new Response(bufferToArrayBuffer(webpBuffer), {
    headers: new Headers({
      "Cache-Control": "private, max-age=3600",
      "Content-Length": webpBuffer.byteLength.toString(),
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
    }),
  });
}

async function handleHeicImage(
  stream: Readable,
  thumbnailUrl: string | null,
  auth: ReturnType<typeof createDriveAuth>,
): Promise<Response> {
  try {
    return createWebpResponse(await convertHeicToWebp(stream));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn("HEIC conversion failed; trying Drive thumbnail:", message);

    const thumbnailResponse = await fetchDriveThumbnail(thumbnailUrl, auth);

    if (thumbnailResponse) {
      return thumbnailResponse;
    }

    throw error;
  }
}

export async function GET(_request: Request, { params }: RouteContext) {
  const cookieStore = await cookies();
  const authToken = cookieStore.get(siteAuthCookieName)?.value;
  const isAuthenticated = await isValidSiteAuthToken(
    authToken,
    process.env.VIEW_PASSWORD,
  );

  if (!isAuthenticated) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { fileId } = await params;

  if (!fileId || !/^[\w-]+$/.test(fileId)) {
    return new Response("Invalid file id", { status: 400 });
  }

  try {
    const syncedImage = await getSyncedDriveImage(fileId);

    if (!syncedImage) {
      return new Response("Not found", { status: 404 });
    }

    const auth = createDriveAuth();
    const drive = createDriveClient(auth);
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" },
    );

    if (!(response.data instanceof Readable)) {
      return new Response("Drive image stream was unavailable", {
        status: 502,
      });
    }

    const contentType =
      getHeaderValue(response.headers, "content-type") ?? "image/jpeg";

    if (isHeicImage(contentType, syncedImage.name)) {
      return handleHeicImage(response.data, syncedImage.thumbnail_url, auth);
    }

    const headers = new Headers({
      "Cache-Control": "private, max-age=3600",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    const contentLength = getHeaderValue(response.headers, "content-length");

    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    // Stream through the server so private Drive files never expose credentials to the client.
    const stream = Readable.toWeb(
      response.data,
    ) as unknown as ReadableStream<Uint8Array>;

    return new Response(stream, { headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Drive image proxy error:", message);
    return new Response("Unable to load image", { status: 502 });
  }
}
