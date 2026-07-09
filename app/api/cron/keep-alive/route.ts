import { createDriveImageAdminClient } from "@/app/lib/drive-images/store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.warn("WARNING: CRON_SECRET is not set in environment variables.");
    if (process.env.NODE_ENV === "development") {
      console.log("Local development mode: bypassing CRON_SECRET check.");
    } else {
      console.error("Production mode: CRON_SECRET is required but missing. Request rejected.");
      return new Response("Unauthorized: CRON_SECRET is missing", { status: 401 });
    }
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn(
      `Unauthorized cron access attempt. Received header: ${
        authHeader ? "present (value masked)" : "missing"
      }`
    );
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabase = createDriveImageAdminClient();
    const { error } = await supabase
      .from("drive_images")
      .select("drive_file_id")
      .limit(1);

    if (error) {
      throw error;
    }

    console.log("Keep-alive: Supabase connection pinged successfully.");
    return NextResponse.json({
      success: true,
      message: "Database connection is active",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Keep-alive error:", errorMessage);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
}

