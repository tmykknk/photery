import { isValidSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n").replace(
        /"/g,
        "",
      ),
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });

    const drive = google.drive({ version: "v3", auth });

    const res = await drive.files.list({
      q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: "files(id, name, thumbnailLink)",
    });

    const files = res.data.files || [];

    for (const file of files) {
      const thumbnailUrl = file.thumbnailLink ?? null;

      const { error } = await supabase.from("drive_images").upsert(
        {
          drive_file_id: file.id,
          name: file.name,
          thumbnail_url: thumbnailUrl,
        },
        { onConflict: "drive_file_id" },
      );

      if (error) {
        console.error("Supabase保存エラー:", error.message);
        throw error;
      }
    }

    return NextResponse.json({ success: true, count: files.length });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("エラー詳細:", errorMessage);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
}
