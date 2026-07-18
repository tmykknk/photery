import "server-only";

import type { GoogleDriveAuth } from "./google-drive";
import { bufferToArrayBuffer } from "./heic";

const defaultPreferredThumbnailSize = 2048;

interface DriveThumbnailOptions {
  preferredSize?: number;
  convertToWebp?: boolean;
}

function isAllowedGoogleThumbnailUrl(thumbnailUrl: string): boolean {
  try {
    const url = new URL(thumbnailUrl);
    const host = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (host === "drive.google.com" ||
        host === "lh3.googleusercontent.com" ||
        host.endsWith(".googleusercontent.com"))
    );
  } catch {
    return false;
  }
}

function getGoogleThumbnailCandidates(
  thumbnailUrl: string,
  preferredSize: number,
): string[] {
  const candidates = [thumbnailUrl];

  try {
    const url = new URL(thumbnailUrl);
    const sizedUrl = new URL(thumbnailUrl);

    if (/=s\d+(?:-[a-z]+)?$/i.test(url.pathname)) {
      sizedUrl.pathname = url.pathname.replace(
        /=s\d+(?:-[a-z]+)?$/i,
        `=s${preferredSize}`,
      );
    } else if (url.searchParams.has("sz")) {
      sizedUrl.searchParams.set("sz", `w${preferredSize}`);
    } else {
      sizedUrl.searchParams.set("sz", `w${preferredSize}`);
    }

    candidates.unshift(sizedUrl.toString());
  } catch {
    return candidates;
  }

  return [...new Set(candidates)];
}

async function fetchAuthorizedImage(
  imageUrl: string,
  token: string,
  options: Required<DriveThumbnailOptions>,
): Promise<Response | null> {
  const response = await fetch(imageUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";

  if (!contentType.toLowerCase().startsWith("image/")) {
    return null;
  }

  const body = Buffer.from(await response.arrayBuffer());
  let output: Buffer<ArrayBufferLike> = body;
  let outputContentType = contentType;

  if (options.convertToWebp) {
    const { default: sharp } = await import("sharp");
    output = await sharp(body, { autoOrient: true })
      .resize({
        width: options.preferredSize,
        height: options.preferredSize,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 3 })
      .toBuffer();
    outputContentType = "image/webp";
  }

  const headers = new Headers({
    "Cache-Control": "private, max-age=3600",
    "Content-Length": output.byteLength.toString(),
    "Content-Type": outputContentType,
    "X-Content-Type-Options": "nosniff",
  });

  return new Response(bufferToArrayBuffer(output), { headers });
}

export async function fetchDriveThumbnail(
  thumbnailUrl: string | null,
  auth: GoogleDriveAuth,
  options: DriveThumbnailOptions = {},
): Promise<Response | null> {
  if (!thumbnailUrl || !isAllowedGoogleThumbnailUrl(thumbnailUrl)) {
    return null;
  }

  const accessToken = await auth.getAccessToken();
  const token =
    typeof accessToken === "string" ? accessToken : accessToken.token;

  if (!token) {
    return null;
  }

  const resolvedOptions: Required<DriveThumbnailOptions> = {
    preferredSize: options.preferredSize ?? defaultPreferredThumbnailSize,
    convertToWebp: options.convertToWebp ?? false,
  };

  for (const candidateUrl of getGoogleThumbnailCandidates(
    thumbnailUrl,
    resolvedOptions.preferredSize,
  )) {
    if (!isAllowedGoogleThumbnailUrl(candidateUrl)) {
      continue;
    }

    const imageResponse = await fetchAuthorizedImage(
      candidateUrl,
      token,
      resolvedOptions,
    );

    if (imageResponse) {
      return imageResponse;
    }
  }

  return null;
}
