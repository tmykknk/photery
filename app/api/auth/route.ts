import { createSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import { NextResponse } from "next/server";

interface AuthRequestBody {
  password: string;
}

function isAuthRequestBody(value: unknown): value is AuthRequestBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "password" in value &&
    typeof value.password === "string"
  );
}

function getRequestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

async function getPasswordFromRequest(request: Request): Promise<string | null> {
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
    const correctPassword = process.env.VIEW_PASSWORD;

    if (!password || !correctPassword || password !== correctPassword) {
      return NextResponse.redirect(new URL("/login?error=1", getRequestOrigin(request)));
    }

    const response = NextResponse.redirect(new URL("/", getRequestOrigin(request)));
    const authToken = await createSiteAuthToken(correctPassword);

    // Store a derived token, never the raw viewing password.
    response.cookies.set(siteAuthCookieName, authToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Auth error:", message);
    return NextResponse.redirect(new URL("/login?error=1", getRequestOrigin(request)));
  }
}
