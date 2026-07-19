import {
  isValidSiteAdminToken,
  siteAdminCookieName,
} from "@/app/lib/auth-token";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { Suspense } from "react";
import GalleryShell from "./components/GalleryShell";
import IntroOverlay from "./components/IntroOverlay";
import type { GalleryImage } from "./components/gallery-types";

export const dynamic = "force-dynamic";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

interface DriveImageRow {
  drive_file_id: string;
  name: string | null;
  tags?: string[] | null;
  created_at?: string | null;
}

interface DriveImageTableRow extends DriveImageRow {
  thumbnail_url: string | null;
}

interface Database {
  public: {
    Tables: {
      drive_images: {
        Row: DriveImageTableRow;
        Insert: {
          drive_file_id: string;
          name?: string | null;
          thumbnail_url?: string | null;
          tags?: string[] | null;
          created_at?: string | null;
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
      .select("drive_file_id, name, tags, created_at")
      .order("created_at", { ascending: true })
      .order("drive_file_id", { ascending: true })
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
    thumbnailUrl: `/api/images/${encodeURIComponent(
      row.drive_file_id,
    )}?variant=card`,
    tags: (row.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    capturedAt: row.created_at ?? null,
  };
}

async function GalleryContent() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const imagesPromise = fetchAllDriveImageRows(supabase);
  const isAdminPromise = (async () => {
    const cookieStore = await cookies();

    return isValidSiteAdminToken(
      cookieStore.get(siteAdminCookieName)?.value,
      process.env.ADMIN_PASSWORD,
    );
  })();

  let images: DriveImageRow[];
  let isAdmin: boolean;

  try {
    [images, isAdmin] = await Promise.all([imagesPromise, isAdminPromise]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-6 text-red-700">
        データの取得に失敗しました: {message}
      </div>
    );
  }

  const galleryImages = images.map(normalizeImage);

  return <GalleryShell images={galleryImages} isAdmin={isAdmin} />;
}

function GalleryLoading() {
  return <div className="min-h-[70vh]" aria-label="ギャラリーを読み込み中" />;
}

export default function Home() {
  return (
    <>
      <IntroOverlay />
      <main
        className="min-h-screen bg-[#f7f8f4] px-4 py-8 text-[#161a18] sm:px-6
          md:px-10"
      >
        <Suspense fallback={<GalleryLoading />}>
          <GalleryContent />
        </Suspense>
      </main>
    </>
  );
}
