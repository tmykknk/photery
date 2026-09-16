import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchDriveMedia,
  readBounded,
  type DriveCredentials,
} from "../../../shared/drive-media.ts";
import {
  fallbackImageLimit,
  ImageError,
  imageErrorResponse,
  parseImageRequest,
  privateHeaders,
  signImageTicket,
  ticketLifetime,
} from "../../../shared/image-protocol.ts";

interface ImageDependencies {
  authorize: () => Promise<boolean>;
  createClient: () => SupabaseClient;
  workerUrl: string;
  ticketSecret: string;
  fallbackBudget: number;
  credentials: DriveCredentials;
  fetchMedia?: typeof fetchDriveMedia;
}

export async function createImageResponse(
  request: Request,
  fileId: string,
  dependencies: ImageDependencies,
) {
  try {
    if (!(await dependencies.authorize()))
      throw new ImageError("unauthorized", 401);
    const query = new URL(request.url);
    const image = parseImageRequest(query, fileId);
    const supabase = dependencies.createClient();
    const { data: row, error } = await supabase
      .from("drive_images")
      .select("drive_file_id,name")
      .eq("drive_file_id", fileId)
      .maybeSingle();
    if (error) throw new ImageError("metadata_unavailable", 503);
    if (!row) throw new ImageError("image_not_found", 404);

    if (query.searchParams.get("fallback") === "1") {
      if (image.variant === "download")
        throw new ImageError("download_temporarily_unavailable", 503);
      const budget = dependencies.fallbackBudget;
      if (
        !Number.isSafeInteger(budget) ||
        budget < fallbackImageLimit ||
        budget > 8_000_000_000
      )
        throw new ImageError("fallback_disabled", 503);

      // 画像を取得する前に最大送信量を予約する。
      const { data: reservation, error: reserveError } = await supabase.rpc(
        "reserve_image_transfer",
        { p_budget: budget },
      );
      if (reserveError) throw new ImageError("budget_unavailable", 503);
      if (typeof reservation !== "string")
        throw new ImageError("fallback_budget_exhausted", 429);
      try {
        const media = await (dependencies.fetchMedia ?? fetchDriveMedia)(
          image,
          dependencies.credentials,
          fetch,
          AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
        );
        const bytes = await readBounded(media.response, fallbackImageLimit);
        const { error: settleError } = await supabase.rpc(
          "settle_image_transfer",
          { p_id: reservation, p_bytes: bytes.byteLength },
        );
        if (settleError) throw new ImageError("budget_unavailable", 503);
        console.log(
          JSON.stringify({
            event: "image_delivery",
            route: "fallback",
            bytes: bytes.byteLength,
            status: 200,
          }),
        );
        return new Response(bytes, {
          headers: {
            ...privateHeaders,
            "Cache-Control": "private, max-age=300",
            "Content-Type": media.contentType,
            "Content-Length": String(bytes.byteLength),
            "X-Image-Route": "fallback",
          },
        });
      } catch (error) {
        // 未送信分だけ解放する。DB停止時は予約が残り、過少計上しない。
        await supabase.rpc("settle_image_transfer", {
          p_id: reservation,
          p_bytes: 0,
        });
        throw error;
      }
    }

    // 画像バイトを取得せず、チケットだけを返す。
    const worker = new URL(dependencies.workerUrl);
    const local = ["localhost", "127.0.0.1"].includes(worker.hostname);
    if (
      (worker.protocol !== "https:" &&
        !(worker.protocol === "http:" && local)) ||
      worker.username ||
      worker.password
    )
      throw new ImageError("worker_not_configured", 503);
    const now = Math.floor(Date.now() / 1000);
    const ticket = {
      v: 1 as const,
      aud: "photery-images" as const,
      ...image,
      iat: now,
      exp: now + ticketLifetime,
    };
    const token = await signImageTicket(ticket, dependencies.ticketSecret);
    console.log(
      JSON.stringify({ event: "image_ticket", variant: image.variant }),
    );
    return Response.json(
      {
        url: new URL("/image", worker).href,
        token,
        expiresAt: ticket.exp,
        fileName: row.name ?? "image",
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "image_request_failed",
        code: error instanceof ImageError ? error.code : "unavailable",
      }),
    );
    return imageErrorResponse(error);
  }
}
