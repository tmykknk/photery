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
    const allowed = env.ALLOWED_ORIGINS.split(",")
      .map((value) => value.trim())
      .includes(origin ?? "");
    const cors: Record<string, string> =
      allowed && origin
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Expose-Headers":
              "Content-Disposition, X-Image-Route",
            Vary: "Origin, Authorization",
          }
        : {};
    try {
      if (!allowed) throw new ImageError("origin_denied", 403);
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
      // ヘッダーで受け取り、チケットをURLやアクセスログへ記録しない。
      const ticket = await verifyImageTicket(
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
        env.IMAGE_TICKET_SECRET,
      );
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
        }),
      );
      return imageErrorResponse(error, cors);
    }
  },
} satisfies ExportedHandler<Env>;
