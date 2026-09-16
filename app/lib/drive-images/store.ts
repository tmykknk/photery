import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DriveImageFile } from "./google-drive";

interface DriveImageIdRow {
  drive_file_id: string;
}

const staleDeleteBatchSize = 100;
const staleSelectPageSize = 1000;

export type DriveImageSupabaseClient = SupabaseClient;

export function createDriveImageAdminClient(): DriveImageSupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase credentials are missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
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

export async function upsertDriveImages(
  files: DriveImageFile[],
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const supabase = createDriveImageAdminClient();
  const { error } = await supabase.from("drive_images").upsert(
    files.map((file) => ({
      drive_file_id: file.id,
      name: file.name,
      tags: file.tags,
      folder_order: file.folderOrder,
      width: file.width,
      height: file.height,
    })),
    { onConflict: "drive_file_id" },
  );

  if (error) {
    console.error("Supabase保存エラー:", error.message);
    throw error;
  }
}

async function fetchExistingDriveImageIds(
  supabase: DriveImageSupabaseClient,
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

export async function deleteStaleDriveImages(
  syncedFileIds: Set<string>,
): Promise<number> {
  const supabase = createDriveImageAdminClient();
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

  return staleFileIds.length;
}
