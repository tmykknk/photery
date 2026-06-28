import {
  constantTimeEqual,
  createSiteAdminToken,
  createSiteAuthToken,
  siteAdminCookieName,
  siteAuthCookieName,
} from "@/app/lib/auth-token";
import { NextResponse } from "next/server";

interface AuthRequestBody {
  password: string;
}

const authCookieMaxAge = 60 * 60 * 24;
const secureCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: authCookieMaxAge,
  path: "/",
};

function isAuthRequestBody(value: unknown): value is AuthRequestBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "password" in value &&
    typeof value.password === "string"
  );
}

function redirectAfterPost(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path },
  });
}

async function getPasswordFromRequest(
  request: Request,
): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body: unknown = await request.json();
    return isAuthRequestBody(body) ? body.password : null;
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const password = formData.get("password");
    return typeof password === "string" ? password : null;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const password = await getPasswordFromRequest(request);
    const viewerPassword = process.env.VIEW_PASSWORD;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const isViewer =
      Boolean(password && viewerPassword) &&
      constantTimeEqual(password ?? "", viewerPassword ?? "");
    const isAdmin =
      Boolean(password && adminPassword) &&
      constantTimeEqual(password ?? "", adminPassword ?? "");

    if (!password || (!isViewer && !isAdmin) || !viewerPassword) {
      return redirectAfterPost("/login?error=1");
    }

    const response = redirectAfterPost("/");
    const authToken = await createSiteAuthToken(viewerPassword);

    // Store derived tokens only. The raw viewer/admin passwords never leave the request body.
    response.cookies.set(siteAuthCookieName, authToken, secureCookieOptions);

    if (isAdmin && adminPassword) {
      const adminToken = await createSiteAdminToken(adminPassword);
      response.cookies.set(
        siteAdminCookieName,
        adminToken,
        secureCookieOptions,
      );
    } else {
      response.cookies.set(siteAdminCookieName, "", {
        ...secureCookieOptions,
        maxAge: 0,
      });
    }

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Auth error:", message);
    return redirectAfterPost("/login?error=1");
  }
}
