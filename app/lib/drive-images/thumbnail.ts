import "server-only";

import type { GoogleDriveAuth } from "./google-drive";

const preferredThumbnailSize = 2048;

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

function getGoogleThumbnailCandidates(thumbnailUrl: string): string[] {
  const candidates = [thumbnailUrl];

  try {
    const url = new URL(thumbnailUrl);
    const sizedUrl = new URL(thumbnailUrl);

    if (/=s\d+(?:-[a-z]+)?$/i.test(url.pathname)) {
      sizedUrl.pathname = url.pathname.replace(
        /=s\d+(?:-[a-z]+)?$/i,
        `=s${preferredThumbnailSize}`,
      );
    } else if (url.searchParams.has("sz")) {
      sizedUrl.searchParams.set("sz", `w${preferredThumbnailSize}`);
    } else {
      sizedUrl.searchParams.set("sz", `w${preferredThumbnailSize}`);
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

  const body = await response.arrayBuffer();
  const headers = new Headers({
    "Cache-Control": "private, max-age=3600",
    "Content-Length": body.byteLength.toString(),
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });

  return new Response(body, { headers });
}

export async function fetchDriveThumbnail(
  thumbnailUrl: string | null,
  auth: GoogleDriveAuth,
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

  for (const candidateUrl of getGoogleThumbnailCandidates(thumbnailUrl)) {
    if (!isAllowedGoogleThumbnailUrl(candidateUrl)) {
      continue;
    }

    const imageResponse = await fetchAuthorizedImage(candidateUrl, token);

    if (imageResponse) {
      return imageResponse;
    }
  }

  return null;
}
