import { isValidSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface DriveImageFile {
  id: string;
  name: string | null;
  thumbnailLink: string | null;
}

interface DriveImageIdRow {
  drive_file_id: string;
}

const staleDeleteBatchSize = 100;
const staleSelectPageSize = 1000;

function getDriveFolderIds(): string[] {
  return (process.env.GOOGLE_DRIVE_FOLDER_ID ?? "")
    .split(",")
    .map((folderId) => folderId.trim())
    .filter((folderId) => folderId.length > 0);
}

function isDriveImageFile(file: {
  id?: string | null;
  name?: string | null;
  thumbnailLink?: string | null;
}): file is DriveImageFile {
  return typeof file.id === "string" && file.id.length > 0;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function isDriveImageIdRow(value: unknown): value is DriveImageIdRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "drive_file_id" in value &&
    typeof value.drive_file_id === "string"
  );
}

async function fetchExistingDriveImageIds(
  supabase: SupabaseClient,
): Promise<string[]> {
  const driveFileIds: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("drive_images")
      .select("drive_file_id")
      .range(offset, offset + staleSelectPageSize - 1);

    if (error) {
      console.error("Supabase取得エラー:", error.message);
      throw error;
    }

    const rows = (data ?? []).filter(isDriveImageIdRow);
    driveFileIds.push(...rows.map((row) => row.drive_file_id));

    if ((data ?? []).length < staleSelectPageSize) {
      return driveFileIds;
    }

    offset += staleSelectPageSize;
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

  try {
    const folderIds = getDriveFolderIds();

    if (folderIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "GOOGLE_DRIVE_FOLDER_ID is missing." },
        { status: 500 },
      );
    }

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
    const filesById = new Map<string, DriveImageFile>();

    for (const folderId of folderIds) {
      let pageToken: string | undefined;

      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
          fields: "nextPageToken, files(id, name, thumbnailLink)",
          pageSize: 1000,
          pageToken,
        });

        for (const file of res.data.files ?? []) {
          if (isDriveImageFile(file)) {
            filesById.set(file.id, file);
          }
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    const files = [...filesById.values()];

    const syncedFileIds = new Set(files.map((file) => file.id));

    if (files.length > 0) {
      const { error } = await supabase.from("drive_images").upsert(
        files.map((file) => ({
          drive_file_id: file.id,
          name: file.name,
          thumbnail_url: file.thumbnailLink,
        })),
        { onConflict: "drive_file_id" },
      );

      if (error) {
        console.error("Supabase保存エラー:", error.message);
        throw error;
      }
    }

    const existingFileIds = await fetchExistingDriveImageIds(supabase);
    const staleFileIds = existingFileIds.filter(
      (fileId) => !syncedFileIds.has(fileId),
    );

    for (const staleFileIdBatch of chunkArray(
      staleFileIds,
      staleDeleteBatchSize,
    )) {
      const { error } = await supabase
        .from("drive_images")
        .delete()
        .in("drive_file_id", staleFileIdBatch);

      if (error) {
        console.error("Supabase削除エラー:", error.message);
        throw error;
      }
    }

    return NextResponse.json({
      success: true,
      count: files.length,
      deletedCount: staleFileIds.length,
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
