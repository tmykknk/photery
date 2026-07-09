import { createDriveImageAdminClient } from "@/app/lib/drive-images/store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
