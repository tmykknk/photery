import "server-only";

import type { GoogleDriveAuth } from "./google-drive";

const defaultPreferredThumbnailSize = 2048;

interface DriveThumbnailOptions {
  preferredSize?: number;
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

  if (!response.body) {
    return null;
  }

  const headers = new Headers({
    "Cache-Control": "private, max-age=3600",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  const contentLength = response.headers.get("content-length");

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(response.body, { headers });
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

  const preferredSize = options.preferredSize ?? defaultPreferredThumbnailSize;

  for (const candidateUrl of getGoogleThumbnailCandidates(
    thumbnailUrl,
    preferredSize,
  )) {
    if (!isAllowedGoogleThumbnailUrl(candidateUrl)) {
      continue;
    }

    try {
      const imageResponse = await fetchAuthorizedImage(candidateUrl, token);

      if (imageResponse) {
        return imageResponse;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Drive thumbnail candidate failed:", message);
    }
  }

  return null;
}
