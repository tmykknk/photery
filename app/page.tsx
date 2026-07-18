import {
  isValidSiteAdminToken,
  siteAdminCookieName,
} from "@/app/lib/auth-token";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import GalleryShell from "./components/GalleryShell";
import type { GalleryImage } from "./components/gallery-types";

export const dynamic = "force-dynamic";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

interface DriveImageRow {
  drive_file_id: string;
  name: string | null;
  thumbnail_url: string | null;
  tags?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  captured_at?: string | null;
}

interface Database {
  public: {
    Tables: {
      drive_images: {
        Row: DriveImageRow;
        Insert: {
          drive_file_id: string;
          name?: string | null;
          thumbnail_url?: string | null;
          tags?: string[] | null;
          created_at?: string | null;
          updated_at?: string | null;
          captured_at?: string | null;
        };
        Update: Partial<DriveImageRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, Json>;
  };
}

function stripFileExtension(name: string): string {
  return name
    .replace(/\.(?:jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i, "")
    .trim();
}

const galleryPageSize = 1000;

async function fetchAllDriveImageRows(
  supabase: SupabaseClient<Database>,
): Promise<DriveImageRow[]> {
  const rows: DriveImageRow[] = [];
  let from = 0;

  while (true) {
    const to = from + galleryPageSize - 1;
    const { data, error } = await supabase
      .from("drive_images")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    rows.push(...(data ?? []));

    if (!data || data.length < galleryPageSize) {
      return rows;
    }

    from += galleryPageSize;
  }
}

function normalizeImage(row: DriveImageRow): GalleryImage {
  const originalName = row.name?.trim() || "Untitled image";
  const name = stripFileExtension(originalName) || "Untitled image";

  return {
    driveFileId: row.drive_file_id,
    name,
    imageUrl: `/api/images/${encodeURIComponent(row.drive_file_id)}`,
    tags: (row.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    capturedAt: row.captured_at ?? row.created_at ?? row.updated_at ?? null,
  };
}

export default async function Home() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let images: DriveImageRow[];

  try {
    images = await fetchAllDriveImageRows(supabase);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="min-h-screen bg-[#f7f8f4] p-6 text-[#161a18] md:p-10">
        <div className="rounded-md border border-red-200 bg-red-50 p-6 text-red-700">
          データの取得に失敗しました: {message}
        </div>
      </main>
    );
  }

  const galleryImages = images.map(normalizeImage);
  const cookieStore = await cookies();
  const isAdmin = await isValidSiteAdminToken(
    cookieStore.get(siteAdminCookieName)?.value,
    process.env.ADMIN_PASSWORD,
  );

  return (
    <main
      className="min-h-screen bg-[#f7f8f4] px-4 py-8 text-[#161a18] sm:px-6
        md:px-10"
    >
      <GalleryShell images={galleryImages} isAdmin={isAdmin} />
    </main>
  );
}
