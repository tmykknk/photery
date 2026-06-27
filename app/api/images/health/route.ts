import { isValidSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import { createDriveAuth } from "@/app/lib/drive-images/google-drive";
import { createDriveImageAdminClient } from "@/app/lib/drive-images/store";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface HealthCheck {
  name: string;
  ok: boolean;
  message?: string;
}

async function checkSupabase(): Promise<HealthCheck> {
  try {
    const supabase = createDriveImageAdminClient();
    const { error } = await supabase
      .from("drive_images")
      .select("drive_file_id")
      .limit(1);

    if (error) {
      return { name: "supabase", ok: false, message: error.message };
    }

    return { name: "supabase", ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "supabase", ok: false, message };
  }
}

async function checkDriveAuth(): Promise<HealthCheck> {
  try {
    const auth = createDriveAuth();
    const accessToken = await auth.getAccessToken();
    const token =
      typeof accessToken === "string" ? accessToken : accessToken.token;

    return token
      ? { name: "driveAuth", ok: true }
      : { name: "driveAuth", ok: false, message: "No access token returned." };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "driveAuth", ok: false, message };
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get(siteAuthCookieName)?.value;
  const isAuthenticated = await isValidSiteAuthToken(
    authToken,
    process.env.VIEW_PASSWORD,
  );

  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks = await Promise.all([checkSupabase(), checkDriveAuth()]);
  const ok = checks.every((check) => check.ok);

  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 500 });
}
