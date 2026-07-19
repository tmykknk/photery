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

function getColumnCount(viewportWidth: number): number {
  if (viewportWidth >= 1024) {
    return 4;
  }

  if (viewportWidth >= 768) {
    return 3;
  }

  return 2;
}

function useResponsiveColumnCount(): number {
  const [columnCount, setColumnCount] = useState(2);

  useEffect(() => {
    const updateColumnCount = () =>
      setColumnCount(getColumnCount(window.innerWidth));

    updateColumnCount();
    window.addEventListener("resize", updateColumnCount);

    return () => window.removeEventListener("resize", updateColumnCount);
  }, []);

  return columnCount;
}

function distributeImagesAcrossColumns(
  images: GalleryImage[],
  columnCount: number,
): Array<Array<{ image: GalleryImage; index: number }>> {
  const columns = Array.from(
    { length: columnCount },
    () =>
      [] as Array<{
        image: GalleryImage;
        index: number;
      }>,
  );

  images.forEach((image, index) => {
    const column = columns[index % columnCount];

    if (column) {
      column.push({ image, index });
    }
  });

  return columns;
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
      className="group block w-full cursor-pointer overflow-hidden rounded-none
        border border-[#d7dedb] bg-white text-left
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
  const columnCount = useResponsiveColumnCount();
  const columns = distributeImagesAcrossColumns(renderedImages, columnCount);
  const eagerImageIndices = new Set(
    renderedImages.slice(0, columnCount * 5).map((_, index) => index),
  );
  const priorityImageIndices = new Set(
    renderedImages.slice(0, columnCount * 2).map((_, index) => index),
  );

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
      <section
        aria-label="写真一覧"
        className="grid items-start gap-3 sm:gap-4"
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        }}
      >
        {columns.map((column, columnIndex) => (
          <div key={columnIndex} className="grid content-start gap-3 sm:gap-4">
            {column.map(({ image, index }) => (
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
          </div>
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
