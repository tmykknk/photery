import { isValidSiteAuthToken, siteAuthCookieName } from "@/app/lib/auth-token";
import { createDriveImageAdminClient } from "@/app/lib/drive-images/store";
import { createImageResponse } from "@/app/lib/drive-images/image-response";
import { cookies } from "next/headers";
import { defaultFallbackBudget } from "@/shared/image-protocol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  return createImageResponse(request, fileId, {
    authorize: async () => {
      const cookieStore = await cookies();
      return isValidSiteAuthToken(
        cookieStore.get(siteAuthCookieName)?.value,
        process.env.VIEW_PASSWORD,
      );
    },
    createClient: createDriveImageAdminClient,
    workerUrl: process.env.IMAGE_WORKER_URL ?? "",
    ticketSecret: process.env.IMAGE_TICKET_SECRET ?? "",
    fallbackBudget: Number(
      process.env.IMAGE_FALLBACK_BUDGET_BYTES ?? defaultFallbackBudget,
    ),
    credentials: {
      email: process.env.GOOGLE_CLIENT_EMAIL ?? "",
      privateKey: process.env.GOOGLE_PRIVATE_KEY ?? "",
    },
  });
}
