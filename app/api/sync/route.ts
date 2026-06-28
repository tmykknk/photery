import {
  isValidSiteAdminToken,
  isValidSiteAuthToken,
  siteAdminCookieName,
  siteAuthCookieName,
} from "@/app/lib/auth-token";
import {
  getDriveFolderIds,
  listDriveImagesInFolders,
} from "@/app/lib/drive-images/google-drive";
import {
  deleteStaleDriveImages,
  upsertDriveImages,
} from "@/app/lib/drive-images/store";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function syncDriveImages() {
  const cookieStore = await cookies();
  const authToken = cookieStore.get(siteAuthCookieName)?.value;
  const adminToken = cookieStore.get(siteAdminCookieName)?.value;
  const isAuthenticated = await isValidSiteAuthToken(
    authToken,
    process.env.VIEW_PASSWORD,
  );
  const isAdmin = await isValidSiteAdminToken(
    adminToken,
    process.env.ADMIN_PASSWORD,
  );

  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sync mutates the global gallery table, so only an admin session cookie can run it.
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const folderIds = getDriveFolderIds();

    if (folderIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "GOOGLE_DRIVE_FOLDER_ID is missing." },
        { status: 500 },
      );
    }

    const files = await listDriveImagesInFolders(folderIds);
    const syncedFileIds = new Set(files.map((file) => file.id));

    await upsertDriveImages(files);
    const deletedCount = await deleteStaleDriveImages(syncedFileIds);

    return NextResponse.json({
      success: true,
      count: files.length,
      deletedCount,
      folderCount: folderIds.length,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("エラー詳細:", errorMessage);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
}

export function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST() {
  return syncDriveImages();
}
