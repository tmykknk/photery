import {
  isValidSiteAdminToken,
  isValidSiteAuthToken,
  siteAdminCookieName,
  siteAuthCookieName,
} from "@/app/lib/auth-token";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createHash } from "node:crypto";
import GalleryShell from "./components/GalleryShell";
import IntroOverlay from "./components/IntroOverlay";
import { getGalleryPage, getGalleryTags } from "./lib/gallery-data";
import type { GalleryPage } from "./components/gallery-types";

export const dynamic = "force-dynamic";

async function GalleryContent() {
  const cookieStore = await cookies();
  if (
    !(await isValidSiteAuthToken(
      cookieStore.get(siteAuthCookieName)?.value,
      process.env.VIEW_PASSWORD,
    ))
  )
    redirect("/login");
  let page: GalleryPage;
  let tags: string[];
  let isAdmin: boolean;
  try {
    [page, tags, isAdmin] = await Promise.all([
      getGalleryPage(),
      getGalleryTags(),
      isValidSiteAdminToken(
        cookieStore.get(siteAdminCookieName)?.value,
        process.env.ADMIN_PASSWORD,
      ),
    ]);
  } catch {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-6 text-red-700"
      >
        画像を読み込めませんでした。時間をおいて再読み込みしてください。
      </div>
    );
  }
  const version = createHash("sha256")
    .update(JSON.stringify([page, tags]))
    .digest("hex");
  return (
    <GalleryShell
      key={version}
      initialPage={page}
      tags={tags}
      isAdmin={isAdmin}
    />
  );
}

export default function Home() {
  return (
    <>
      <IntroOverlay />
      <main
        className="min-h-screen bg-[#f7f8f4] px-4 py-8 text-[#161a18] sm:px-6
          md:px-10"
      >
        <Suspense
          fallback={
            <div className="min-h-[70vh]" aria-label="ギャラリーを読み込み中" />
          }
        >
          <GalleryContent />
        </Suspense>
      </main>
    </>
  );
}
