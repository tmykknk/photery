import { cookies } from "next/headers";
import { isValidSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import { getGalleryPage } from "@/app/lib/gallery-data";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (
    !(await isValidSiteAuthToken(
      cookieStore.get(siteAuthCookieName)?.value,
      process.env.VIEW_PASSWORD,
    ))
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const query = new URL(request.url).searchParams;
  const offset = Number(query.get("offset") ?? 0);
  const tag = query.get("tag");
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (tag !== null && tag.length > 500)
  ) {
    return Response.json({ error: "Invalid page" }, { status: 400, headers });
  }
  try {
    return Response.json(await getGalleryPage(offset, tag), { headers });
  } catch {
    return Response.json(
      { error: "Unable to load gallery" },
      { status: 503, headers },
    );
  }
}
