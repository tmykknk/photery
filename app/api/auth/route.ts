import {
  constantTimeEqual,
  createSiteAuthToken,
  siteAuthCookieName,
} from "@/app/lib/auth-token";
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

function redirectAfterPost(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path },
  });
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

    if (
      !password ||
      !correctPassword ||
      !constantTimeEqual(password, correctPassword)
    ) {
      return redirectAfterPost("/login?error=1");
    }

    const response = redirectAfterPost("/");
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
    return redirectAfterPost("/login?error=1");
  }
}
