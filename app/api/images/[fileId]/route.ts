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

function createDownloadFilename(fileName: string, contentType: string): string {
  const trimmedName = fileName.trim() || "image";

  if (contentType === "image/webp") {
    return trimmedName.replace(/\.[^.]+$/, "") + ".webp";
  }

  return trimmedName;
}

function createContentDisposition(
  fileName: string,
  dispositionType: "attachment" | "inline",
): string {
  const fallbackName = fileName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\";]/g, "_");

  return `${dispositionType}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function addDownloadHeader(
  headers: Headers,
  fileName: string,
  contentType: string,
) {
  headers.set(
    "Content-Disposition",
    createContentDisposition(
      createDownloadFilename(fileName, contentType),
      "attachment",
    ),
  );
}

function addInlineFileNameHeader(
  headers: Headers,
  fileName: string,
  contentType: string,
) {
  headers.set(
    "Content-Disposition",
    createContentDisposition(
      createDownloadFilename(fileName, contentType),
      "inline",
    ),
  );
}

function createWebpResponse(
  webpBuffer: Buffer,
  fileName: string,
  isDownload: boolean,
): Response {
  const headers = new Headers({
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Length": webpBuffer.byteLength.toString(),
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
  });

  if (isDownload) {
    addDownloadHeader(headers, fileName, "image/webp");
  } else {
    addInlineFileNameHeader(headers, fileName, "image/webp");
  }

  return new Response(bufferToArrayBuffer(webpBuffer), {
    headers,
  });
}

function logImageProxyError(stage: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Drive image proxy error (${stage}):`, message);
}

async function handleHeicImage(
  stream: Readable,
  thumbnailUrl: string | null,
  auth: ReturnType<typeof createDriveAuth>,
  fileName: string,
  isDownload: boolean,
): Promise<Response> {
  try {
    return createWebpResponse(
      await convertHeicToWebp(stream),
      fileName,
      isDownload,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn("HEIC conversion failed; trying Drive thumbnail:", message);

    const thumbnailResponse = await fetchDriveThumbnail(thumbnailUrl, auth);

    if (thumbnailResponse) {
      if (isDownload) {
        addDownloadHeader(
          thumbnailResponse.headers,
          fileName,
          thumbnailResponse.headers.get("Content-Type") ?? "image/jpeg",
        );
      }
      return thumbnailResponse;
    }

    throw error;
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
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

    const syncedImage = await getSyncedDriveImage(fileId);

    if (!syncedImage) {
      return new Response("Not found", { status: 404 });
    }

    const fileName = syncedImage.name?.trim() || "image";
    const auth = createDriveAuth();
    const searchParams = new URL(request.url).searchParams;
    const variant = searchParams.get("variant");
    const isDownloadRequest = searchParams.get("download") === "1";
    const isInline = searchParams.get("inline") === "1";

    // 1. Try serving resized thumbnail for display requests (variant=card or lightbox)
    if (!isDownloadRequest && (variant === "card" || variant === "lightbox")) {
      const preferredSize = variant === "card" ? 600 : 1400;
      const thumbnailResponse = await fetchDriveThumbnail(
        syncedImage.thumbnail_url,
        auth,
        { preferredSize },
      );

      if (thumbnailResponse) {
        if (isInline) {
          addInlineFileNameHeader(
            thumbnailResponse.headers,
            fileName,
            thumbnailResponse.headers.get("Content-Type") ?? "image/jpeg",
          );
        }
        return thumbnailResponse;
      }
    }

    // 2. Full-size streaming (for downloads or fallback when thumbnail is unavailable)
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
      return handleHeicImage(
        response.data,
        syncedImage.thumbnail_url,
        auth,
        fileName,
        isDownloadRequest,
      );
    }

    const headers = new Headers({
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    const contentLength = getHeaderValue(response.headers, "content-length");

    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    if (isDownloadRequest) {
      addDownloadHeader(headers, fileName, contentType);
    } else if (isInline) {
      addInlineFileNameHeader(headers, fileName, contentType);
    }

    const stream = Readable.toWeb(
      response.data,
    ) as unknown as ReadableStream<Uint8Array>;

    return new Response(stream, { headers });
  } catch (error: unknown) {
    logImageProxyError("request", error);
    return new Response("Unable to load image", { status: 502 });
  }
}
