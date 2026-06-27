import { isValidSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { cookies } from "next/headers";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    fileId: string;
  }>;
}

interface DriveImageRow {
  drive_file_id: string;
}

interface Database {
  public: {
    Tables: {
      drive_images: {
        Row: DriveImageRow;
        Insert: DriveImageRow;
        Update: Partial<DriveImageRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

function getHeaderValue(
  headers: Headers | Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(key);
  }

  const value = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function createDriveClient() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n").replace(
    /"/g,
    "",
  );

  if (!email || !key) {
    throw new Error("Google Drive service account credentials are missing.");
  }

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

async function isSyncedDriveImage(fileId: string): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase credentials are missing.");
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from("drive_images")
    .select("drive_file_id")
    .eq("drive_file_id", fileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data !== null;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const cookieStore = await cookies();
  const authToken = cookieStore.get(siteAuthCookieName)?.value;
  const isAuthenticated = await isValidSiteAuthToken(
    authToken,
    process.env.VIEW_PASSWORD,
  );

  if (!isAuthenticated) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { fileId } = await params;

  if (!fileId || !/^[\w-]+$/.test(fileId)) {
    return new Response("Invalid file id", { status: 400 });
  }

  try {
    if (!(await isSyncedDriveImage(fileId))) {
      return new Response("Not found", { status: 404 });
    }

    const drive = createDriveClient();
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" },
    );

    if (!(response.data instanceof Readable)) {
      return new Response("Drive image stream was unavailable", {
        status: 502,
      });
    }

    const contentType =
      getHeaderValue(response.headers, "content-type") ?? "image/jpeg";
    const contentLength = getHeaderValue(response.headers, "content-length");
    const headers = new Headers({
      "Cache-Control": "private, max-age=3600",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });

    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    // Stream through the server so private Drive files never expose credentials to the client.
    const stream = Readable.toWeb(
      response.data,
    ) as unknown as ReadableStream<Uint8Array>;

    return new Response(stream, { headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Drive image proxy error:", message);
    return new Response("Unable to load image", { status: 502 });
  }
}
