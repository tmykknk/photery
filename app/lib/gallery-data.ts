import "server-only";
import { createDriveImageAdminClient } from "./drive-images/store";
import type { GalleryPage } from "../components/gallery-types";

const pageSize = 60;

export async function getGalleryPage(
  offset = 0,
  tag: string | null = null,
): Promise<GalleryPage> {
  const supabase = createDriveImageAdminClient();
  let query = supabase
    .from("drive_images")
    .select("drive_file_id,name,tags,folder_order,created_at,width,height", {
      count: "exact",
    });
  if (tag !== null) query = query.contains("tags", [tag]);
  else
    query = query.order("folder_order", { ascending: true, nullsFirst: false });
  const { data, error, count } = await query
    .order("name", { ascending: true, nullsFirst: false })
    .order("drive_file_id", { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (error) throw new Error("Unable to load gallery");

  // 画像本体とチケットは埋め込まず、必要なメタデータだけを返す。
  const images = (data ?? []).map((row) => {
    const originalName: string = row.name?.trim() || "Untitled image";
    const base = `/api/images/${encodeURIComponent(row.drive_file_id)}`;
    return {
      driveFileId: row.drive_file_id as string,
      name:
        originalName
          .replace(/\.(?:jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i, "")
          .trim() || originalName,
      originalFileName: originalName,
      thumbnailUrl: `${base}?variant=card`,
      lightboxUrl: `${base}?variant=lightbox`,
      tags: (row.tags ?? []) as string[],
      folderOrder: row.folder_order ?? Number.MAX_SAFE_INTEGER,
      capturedAt: row.created_at as string | null,
      aspectRatio: row.width && row.height ? row.width / row.height : undefined,
    };
  });
  const totalCount = count ?? 0;
  return {
    images,
    totalCount,
    nextOffset:
      images.length > 0 && offset + images.length < totalCount
        ? offset + images.length
        : null,
  };
}

export async function getGalleryTags(): Promise<string[]> {
  const { data, error } = await createDriveImageAdminClient().rpc(
    "photery_gallery_tags",
  );
  if (error) throw new Error("Unable to load gallery tags");
  return (data ?? []).map((row: { tag: string }) => row.tag);
}
