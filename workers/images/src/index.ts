import {
  contentDisposition,
  fetchDriveMedia,
} from "../../../shared/drive-media.ts";
import {
  ImageError,
  imageErrorResponse,
  privateHeaders,
  verifyImageTicket,
} from "../../../shared/image-protocol.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const origin = request.headers.get("origin");
    const cors: Record<string, string> = { Vary: "Origin, Authorization" };
    try {
      // ローカル・本番とも、設定不足は秘密値を出さず明示的に拒否する。
      const origins =
        typeof env.ALLOWED_ORIGINS === "string"
          ? env.ALLOWED_ORIGINS.split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : [];
      if (origins.length === 0)
        throw new ImageError("allowed_origins_not_configured", 503);
      if (!origin || !origins.includes(origin))
        throw new ImageError("origin_denied", 403);
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Access-Control-Expose-Headers"] =
        "Content-Disposition, X-Image-Route";
      if (request.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            ...privateHeaders,
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Allow-Headers": "Authorization",
            "Access-Control-Max-Age": "300",
          },
        });
      if (request.method !== "GET")
        throw new ImageError("method_not_allowed", 405);
      const url = new URL(request.url);
      if (url.pathname !== "/image") throw new ImageError("not_found", 404);
      if (
        typeof env.IMAGE_TICKET_SECRET !== "string" ||
        env.IMAGE_TICKET_SECRET.length < 32
      )
        throw new ImageError("signing_not_configured", 503);
      // ヘッダーで受け取り、チケットをURLやアクセスログへ記録しない。
      const ticket = await verifyImageTicket(
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
        env.IMAGE_TICKET_SECRET,
      );
      if (
        typeof env.GOOGLE_CLIENT_EMAIL !== "string" ||
        !env.GOOGLE_CLIENT_EMAIL.trim() ||
        typeof env.GOOGLE_PRIVATE_KEY !== "string" ||
        !env.GOOGLE_PRIVATE_KEY.trim()
      )
        throw new ImageError("drive_credentials_not_configured", 503);
      const { response, contentType, fileName } = await fetchDriveMedia(
        ticket,
        { email: env.GOOGLE_CLIENT_EMAIL, privateKey: env.GOOGLE_PRIVATE_KEY },
        fetch,
        AbortSignal.any([
          request.signal,
          AbortSignal.timeout(ticket.variant === "download" ? 120_000 : 20_000),
        ]),
      );
      const remaining = Math.max(0, ticket.exp - Math.floor(Date.now() / 1000));
      const headers = new Headers({
        ...cors,
        ...privateHeaders,
        "Cache-Control":
          ticket.variant === "download"
            ? "private, no-store"
            : `private, max-age=${remaining}`,
        "Content-Type": contentType,
        "X-Image-Route": "worker",
      });
      if (ticket.variant === "download")
        headers.set("Content-Disposition", contentDisposition(fileName));
      const length = response.headers.get("content-length");
      if (length) headers.set("Content-Length", length);
      console.log(
        JSON.stringify({
          event: "image_delivery",
          route: "worker",
          variant: ticket.variant,
          status: 200,
          bytes: length ? Number(length) : null,
        }),
      );
      return new Response(response.body, { headers });
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "image_delivery",
          route: "worker",
          status: error instanceof ImageError ? error.status : 503,
          code: error instanceof ImageError ? error.code : "image_unavailable",
        }),
      );
      return imageErrorResponse(error, cors);
    }
  },
} satisfies ExportedHandler<Env>;
