"use client";

import { motion, type Variants } from "framer-motion";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import Lightbox from "./Lightbox";
import type { GalleryImage } from "./gallery-types";
import { getImageDateLabel } from "./gallery-utils";

interface MasonryGalleryProps {
  images: GalleryImage[];
  progressivelyRender: boolean;
}

interface MasonrySectionsProps {
  images: GalleryImage[];
  progressivelyRender: boolean;
  onOpen: (index: number) => void;
}

interface GalleryCardProps {
  image: GalleryImage;
  index: number;
  shouldAnimateImmediately: boolean;
  shouldLoadEagerly: boolean;
  shouldPrioritize: boolean;
  onOpen: () => void;
}

const smoothEase = [0.22, 1, 0.36, 1] as const;
const supportedColumnCounts = [2, 3, 4] as const;
const progressiveBatchSize = 120;

const cardVariants: Variants = {
  hidden: { opacity: 0 },
  visible: (animationOrder: number) => ({
    opacity: 1,
    transition: {
      delay: Math.min(animationOrder, 16) * 0.06,
      duration: 0.72,
      ease: smoothEase,
    },
  }),
};

function getStableAspectRatio(image: GalleryImage): number {
  const ratios = [0.68, 0.74, 0.8, 0.9, 1, 1.12, 1.22, 1.32];
  let hash = 2166136261;

  for (const character of image.driveFileId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return ratios[(hash >>> 0) % ratios.length] ?? 1;
}

function getEstimatedCardHeight(image: GalleryImage): number {
  return 1 / getStableAspectRatio(image) + 0.24;
}

function getLikelyColumnStartIndices(
  images: GalleryImage[],
  columnCount: number,
): number[] {
  const itemCount = images.length;

  if (itemCount === 0) {
    return [];
  }

  const estimatedHeights = images.map(getEstimatedCardHeight);
  const totalHeight = estimatedHeights.reduce((sum, height) => sum + height, 0);
  const startIndices = [0];
  let cumulativeHeight = 0;
  let nextColumn = 1;

  for (
    let index = 0;
    index < itemCount && nextColumn < columnCount;
    index += 1
  ) {
    cumulativeHeight += estimatedHeights[index] ?? 0;

    if (cumulativeHeight >= (totalHeight * nextColumn) / columnCount) {
      startIndices.push(Math.min(index + 1, itemCount - 1));
      nextColumn += 1;
    }
  }

  return startIndices;
}

function getColumnCandidateIndices(
  images: GalleryImage[],
  beforeStart: number,
  afterStart: number,
): Set<number> {
  const itemCount = images.length;
  const candidates = new Set<number>();

  for (const columnCount of supportedColumnCounts) {
    for (const startIndex of getLikelyColumnStartIndices(images, columnCount)) {
      for (let offset = -beforeStart; offset <= afterStart; offset += 1) {
        const candidateIndex = startIndex + offset;

        if (candidateIndex >= 0 && candidateIndex < itemCount) {
          candidates.add(candidateIndex);
        }
      }
    }
  }

  return candidates;
}

function GalleryCard({
  image,
  index,
  shouldAnimateImmediately,
  shouldLoadEagerly,
  shouldPrioritize,
  onOpen,
}: GalleryCardProps) {
  return (
    <motion.button
      type="button"
      custom={shouldAnimateImmediately ? 0 : index}
      variants={cardVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -8% 0px", amount: 0.12 }}
      whileHover={{ y: -2, transition: { duration: 0.12 } }}
      onClick={onOpen}
      className="group mb-4 block w-full cursor-pointer break-inside-avoid
        overflow-hidden rounded-none border border-[#d7dedb] bg-white text-left
        shadow-[0_12px_34px_rgba(17,24,22,0.055)] transition-shadow duration-150
        outline-none hover:shadow-[0_18px_44px_rgba(17,24,22,0.105)]
        focus-visible:ring-2 focus-visible:ring-[#2f5d7c]/25"
    >
      <div
        className="relative w-full overflow-hidden bg-[#e9efec]"
        style={{ aspectRatio: getStableAspectRatio(image) }}
      >
        {image.thumbnailUrl ? (
          <Image
            src={image.thumbnailUrl}
            alt={image.name}
            fill
            sizes="(max-width: 767px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover grayscale-0 transition duration-200 ease-out
              md:grayscale md:group-hover:scale-[1.025]
              md:group-hover:grayscale-0"
            loading={shouldLoadEagerly ? "eager" : "lazy"}
            fetchPriority={shouldPrioritize ? "high" : "auto"}
            unoptimized
          />
        ) : (
          <div
            className="flex h-full items-center justify-center text-sm
              font-medium text-zinc-400"
          >
            No Image
          </div>
        )}
      </div>
      <div className="grid gap-2 p-3">
        <p
          className="font-display truncate text-lg font-semibold text-[#161a18]"
          title={image.name}
        >
          {image.name}
        </p>
        <div
          className="flex flex-wrap gap-2 font-sans text-xs font-semibold
            text-[#68736f]"
        >
          {image.tags.length > 0 ? (
            image.tags.map((tag) => <span key={tag}>#{tag}</span>)
          ) : (
            <span>#未分類</span>
          )}
          <span>{getImageDateLabel(image.capturedAt)}</span>
        </div>
      </div>
    </motion.button>
  );
}

function MasonrySections({
  images,
  progressivelyRender,
  onOpen,
}: MasonrySectionsProps) {
  const [visibleCount, setVisibleCount] = useState(() =>
    progressivelyRender
      ? Math.min(progressiveBatchSize, images.length)
      : images.length,
  );
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const renderedCount = progressivelyRender
    ? Math.min(visibleCount, images.length)
    : images.length;
  const renderedImages = images.slice(0, renderedCount);
  const eagerImageIndices = getColumnCandidateIndices(renderedImages, 1, 5);
  const priorityImageIndices = getColumnCandidateIndices(renderedImages, 1, 1);

  useEffect(() => {
    if (!progressivelyRender || renderedCount >= images.length) {
      return;
    }

    const loadMoreElement = loadMoreRef.current;

    if (!loadMoreElement) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((current) =>
            Math.min(current + progressiveBatchSize, images.length),
          );
        }
      },
      { rootMargin: "1000px 0px" },
    );

    observer.observe(loadMoreElement);

    return () => observer.disconnect();
  }, [images.length, progressivelyRender, renderedCount]);

  return (
    <>
      <section className="columns-2 gap-3 sm:gap-4 md:columns-3 lg:columns-4">
        {renderedImages.map((image, index) => (
          <GalleryCard
            key={image.driveFileId}
            image={image}
            index={index}
            shouldAnimateImmediately={eagerImageIndices.has(index)}
            shouldLoadEagerly={eagerImageIndices.has(index)}
            shouldPrioritize={priorityImageIndices.has(index)}
            onOpen={() => onOpen(index)}
          />
        ))}
      </section>

      {progressivelyRender && renderedCount < images.length ? (
        <div
          ref={loadMoreRef}
          className="h-px"
          aria-label={`全${images.length}枚中${renderedCount}枚を表示中`}
        />
      ) : null}
    </>
  );
}

export default function MasonryGallery({
  images,
  progressivelyRender,
}: MasonryGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const activeImage =
    activeIndex === null ? null : (images[activeIndex] ?? null);

  const showPreviousImage = () => {
    if (images.length === 0) {
      return;
    }

    setActiveIndex((current) =>
      current === null ? null : (current - 1 + images.length) % images.length,
    );
  };

  const showNextImage = () => {
    if (images.length === 0) {
      return;
    }

    setActiveIndex((current) =>
      current === null ? null : (current + 1) % images.length,
    );
  };

  return (
    <div className="grid gap-8">
      {images.length > 0 ? (
        <MasonrySections
          key={progressivelyRender ? "all" : "folder"}
          images={images}
          progressivelyRender={progressivelyRender}
          onOpen={setActiveIndex}
        />
      ) : (
        <div
          className="rounded-none border border-dashed border-[#cbd5d1] bg-white
            px-6 py-12 text-center text-[#68736f]"
        >
          No images to display.
        </div>
      )}

      <Lightbox
        image={activeImage}
        currentIndex={activeIndex}
        totalCount={images.length}
        onClose={() => setActiveIndex(null)}
        onPrevious={showPreviousImage}
        onNext={showNextImage}
      />
    </div>
  );
}
