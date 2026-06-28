import {
  isValidSiteAdminToken,
  siteAdminCookieName,
} from "@/app/lib/auth-token";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import AdminSyncButton from "./components/AdminSyncButton";
import MasonryGallery from "./components/MasonryGallery";
import type { GalleryImage } from "./components/gallery-types";

export const dynamic = "force-dynamic";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

interface DriveImageRow {
  drive_file_id: string;
  name: string | null;
  thumbnail_url: string | null;
  category?: string | null;
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
          category?: string | null;
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

function deriveCategory(name: string): string {
  const [prefix] = name.split(/[-_]/);
  const normalized = prefix?.trim();

  if (!normalized || normalized.length < 3 || normalized === name) {
    return "Date:";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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
    category: row.category?.trim() || deriveCategory(name),
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
      <div className="mx-auto grid max-w-7xl gap-10">
        <header
          className="flex flex-col items-start justify-between gap-5 border-b
            border-[#d7dedb] pb-8 text-left sm:flex-row sm:items-end"
        >
          <div className="grid gap-3">
            <p className="font-mono text-xs tracking-widest text-[#56707c]">
              Share you my memories.
            </p>
            <h1
              className="font-display text-5xl font-semibold tracking-normal
                text-[#111816] sm:text-7xl"
            >
              Photery
            </h1>
          </div>
          {isAdmin ? <AdminSyncButton /> : null}
        </header>

        {galleryImages.length > 0 ? (
          <MasonryGallery images={galleryImages} />
        ) : (
          <div
            className="rounded-none border border-dashed border-[#cbd5d1]
              bg-white px-6 py-12 text-center text-[#68736f]"
          >
            表示できる画像がありません。先に /api/sync を実行してください。
          </div>
        )}
      </div>
    </main>
  );
}
