"use client";

import { useMemo, useState } from "react";
import AdminSyncButton from "./AdminSyncButton";
import type { GalleryImage } from "./gallery-types";
import MasonryGallery from "./MasonryGallery";

interface GalleryShellProps {
  images: GalleryImage[];
  isAdmin: boolean;
}

const fileNameCollator = new Intl.Collator("ja", {
  numeric: true,
  sensitivity: "base",
});

function compareByFileName(a: GalleryImage, b: GalleryImage): number {
  const nameComparison = fileNameCollator.compare(a.name, b.name);

  return nameComparison || a.driveFileId.localeCompare(b.driveFileId);
}

function compareAllImages(a: GalleryImage, b: GalleryImage): number {
  return a.folderOrder - b.folderOrder || compareByFileName(a, b);
}

export default function GalleryShell({ images, isAdmin }: GalleryShellProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const tags = useMemo(
    () => [
      ...new Set(
        [...images].sort(compareAllImages).flatMap((image) => image.tags),
      ),
    ],
    [images],
  );
  const activeTag =
    selectedTag !== null && tags.includes(selectedTag) ? selectedTag : null;
  const sortedImages = useMemo(() => {
    const matchingImages =
      activeTag === null
        ? images
        : images.filter((image) => image.tags.includes(activeTag));

    return [...matchingImages].sort(
      activeTag === null ? compareAllImages : compareByFileName,
    );
  }, [activeTag, images]);

  return (
    <div className="mx-auto grid max-w-7xl gap-10">
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
                  onClick={() => setSelectedTag(tag)}
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

      {images.length > 0 ? (
        <MasonryGallery
          images={sortedImages}
          progressivelyRender={activeTag === null}
        />
      ) : (
        <div
          className="rounded-none border border-dashed border-[#cbd5d1] bg-white
            px-6 py-12 text-center text-[#68736f]"
        >
          表示できる画像がありません。先に /api/sync を実行してください。
        </div>
      )}
    </div>
  );
}
