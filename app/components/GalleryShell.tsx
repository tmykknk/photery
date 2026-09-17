"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminSyncButton from "./AdminSyncButton";
import type { GalleryPage } from "./gallery-types";
import MasonryGallery from "./MasonryGallery";

interface GalleryShellProps {
  initialPage: GalleryPage;
  tags: string[];
  isAdmin: boolean;
}

export default function GalleryShell({
  initialPage,
  tags,
  isAdmin,
}: GalleryShellProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const moreRequestRef = useRef<Promise<number> | null>(null);
  const nextPageRef = useRef<HTMLDivElement>(null);
  const activeTag = selectedTag;

  const loadPage = useCallback(
    async (tag: string | null, offset: number, replace: boolean) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      setError(false);
      try {
        const query = new URLSearchParams({ offset: String(offset) });
        if (tag !== null) query.set("tag", tag);
        const response = await fetch(`/api/gallery?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Gallery request failed");
        const nextPage: GalleryPage = await response.json();
        if (controller.signal.aborted) return 0;
        setPage((current) => ({
          ...nextPage,
          images: replace
            ? nextPage.images
            : [
                ...current.images,
                ...nextPage.images.filter(
                  (image) =>
                    !current.images.some(
                      (loaded) => loaded.driveFileId === image.driveFileId,
                    ),
                ),
              ],
        }));
        return nextPage.images.length;
      } catch {
        if (!controller.signal.aborted) setError(true);
        return 0;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [],
  );

  const loadMore = useCallback((): Promise<number> => {
    if (moreRequestRef.current) return moreRequestRef.current;
    if (page.nextOffset === null) return Promise.resolve(0);
    const pending = loadPage(selectedTag, page.nextOffset, false);
    moreRequestRef.current = pending;
    void pending.finally(() => {
      if (moreRequestRef.current === pending) moreRequestRef.current = null;
    });
    return pending;
  }, [loadPage, page.nextOffset, selectedTag]);

  const selectTag = (tag: string | null) => {
    if (tag === selectedTag) return;
    setSelectedTag(tag);
    moreRequestRef.current = null;
    setPage({ images: [], nextOffset: 0, totalCount: 0 });
    void loadPage(tag, 0, true);
  };

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (loading || error || page.nextOffset === null || !nextPageRef.current)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && page.nextOffset !== null) {
          observer.disconnect();
          void loadMore();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(nextPageRef.current);
    return () => observer.disconnect();
  }, [loading, error, page.nextOffset, loadMore]);

  return (
    <div data-gallery-ready className="mx-auto grid max-w-7xl gap-10">
      <header
        className="flex flex-col items-start justify-between gap-6 border-b
          border-[#d7dedb] pb-8 text-left lg:flex-row lg:items-end"
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

        <div
          className="flex w-full flex-col items-start gap-4 lg:w-auto
            lg:items-end"
        >
          <nav
            aria-label="フォルダタグで写真を絞り込む"
            className="flex max-w-full flex-wrap gap-2"
          >
            {[null, ...tags].map((tag) => {
              const isActive = tag === activeTag;
              const label = tag ?? "すべて";

              return (
                <button
                  key={tag === null ? "filter:all" : `filter:${tag}`}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => selectTag(tag)}
                  className={`rounded-none border px-3 py-2 text-xs font-bold
                  transition duration-150 focus-visible:outline-2
                  focus-visible:outline-[#2f5d7c]/30 ${
                    isActive
                      ? "border-[#2f5d7c] bg-[#2f5d7c] text-white"
                      : `border-[#cbd5d1] bg-white text-[#56707c]
                        hover:shadow-[0_8px_20px_rgba(17,24,22,0.09)]`
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>
          {isAdmin ? <AdminSyncButton /> : null}
        </div>
      </header>

      {page.images.length > 0 ? (
        <MasonryGallery
          key={selectedTag ?? "all"}
          images={page.images}
          progressivelyRender={false}
          hasMore={page.nextOffset !== null}
          totalCount={page.totalCount}
          onLoadMore={loadMore}
        />
      ) : !loading && !error ? (
        <div
          className="rounded-none border border-dashed border-[#cbd5d1] bg-white
            px-6 py-12 text-center text-[#68736f]"
        >
          表示できる画像がありません。
        </div>
      ) : null}
      {loading ? <p role="status">画像を読み込み中…</p> : null}
      {error ? (
        <button
          type="button"
          onClick={() =>
            void loadPage(
              selectedTag,
              page.nextOffset ?? 0,
              page.images.length === 0,
            )
          }
        >
          再試行
        </button>
      ) : null}
      {page.nextOffset !== null ? (
        <div
          ref={nextPageRef}
          className="h-px"
          aria-label="次の画像を読み込む"
        />
      ) : null}
    </div>
  );
}
