export const siteAuthCookieName = "site_auth";

const tokenPrefix = "photery-site-auth:v2:";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

async function createHmacSha256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );

  return toHex(signature);
}

function getSiteAuthSecret(): string | undefined {
  return process.env.SITE_AUTH_SECRET ?? process.env.VIEW_PASSWORD;
}

export async function createSiteAuthToken(password: string): Promise<string> {
  const secret = getSiteAuthSecret();

  if (!secret) {
    throw new Error("Site auth secret is missing.");
  }

  return createHmacSha256(`${tokenPrefix}${password}`, secret);
}

export async function isValidSiteAuthToken(
  token: string | undefined,
  password: string | undefined,
): Promise<boolean> {
  if (!token || !password) {
    return false;
  }

  const expectedToken = await createSiteAuthToken(password);

  return constantTimeEqual(token, expectedToken);
}
