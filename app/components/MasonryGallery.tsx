"use client";

import { AnimatePresence, motion, type Variants } from "framer-motion";
import Image from "next/image";
import { useState } from "react";
import Lightbox from "./Lightbox";
import type { GalleryImage } from "./gallery-types";
import { getImageDateLabel } from "./gallery-utils";

interface MasonryGalleryProps {
  images: GalleryImage[];
}

interface GalleryCardProps {
  image: GalleryImage;
  index: number;
  onOpen: () => void;
}

const smoothEase = [0.22, 1, 0.36, 1] as const;

const cardVariants: Variants = {
  hidden: { opacity: 0 },
  visible: (index: number) => ({
    opacity: 1,
    transition: {
      delay: Math.min(index, 16) * 0.06,
      duration: 0.72,
      ease: smoothEase,
    },
  }),
};

function getStableAspectRatio(index: number): number {
  const ratios = [0.8, 0.72, 1.18, 1, 0.68, 1.32];
  return ratios[index % ratios.length] ?? 1;
}

function IntroMark() {
  return (
    <motion.svg
      width="96"
      height="96"
      viewBox="0 0 96 96"
      role="img"
      aria-label="Photery"
      className="drop-shadow-2xl"
      initial={{ rotate: -18, scale: 0.88 }}
      animate={{ rotate: 0, scale: [0.88, 1.04, 1] }}
      transition={{ duration: 1.1, ease: smoothEase }}
    >
      <defs>
        <linearGradient id="photery-mark" x1="18" y1="16" x2="78" y2="84">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.54" stopColor="#dbe5e1" />
          <stop offset="1" stopColor="#7c9bab" />
        </linearGradient>
      </defs>
      <motion.circle
        cx="48"
        cy="48"
        r="35"
        fill="none"
        stroke="url(#photery-mark)"
        strokeWidth="2.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: smoothEase }}
      />
      <motion.path
        d="M48 23 60 44H36L48 23Z"
        fill="none"
        stroke="url(#photery-mark)"
        strokeLinejoin="round"
        strokeWidth="2.5"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16, duration: 0.42, ease: smoothEase }}
      />
      <motion.path
        d="M73 48 52 60V36L73 48Z"
        fill="none"
        stroke="url(#photery-mark)"
        strokeLinejoin="round"
        strokeWidth="2.5"
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.24, duration: 0.42, ease: smoothEase }}
      />
      <motion.path
        d="M48 73 36 52H60L48 73Z"
        fill="none"
        stroke="url(#photery-mark)"
        strokeLinejoin="round"
        strokeWidth="2.5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32, duration: 0.42, ease: smoothEase }}
      />
      <motion.path
        d="M23 48 44 36V60L23 48Z"
        fill="none"
        stroke="url(#photery-mark)"
        strokeLinejoin="round"
        strokeWidth="2.5"
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.4, duration: 0.42, ease: smoothEase }}
      />
      <circle cx="48" cy="48" r="8" fill="#b24a3b" />
    </motion.svg>
  );
}

function GalleryCard({ image, index, onOpen }: GalleryCardProps) {
  return (
    <motion.button
      type="button"
      custom={index}
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
        style={{ aspectRatio: getStableAspectRatio(index) }}
      >
        {image.imageUrl ? (
          <Image
            src={image.imageUrl}
            alt={image.name}
            fill
            sizes="(max-width: 767px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover grayscale-0 transition duration-200 ease-out
              md:grayscale md:group-hover:scale-[1.025]
              md:group-hover:grayscale-0"
            loading="eager"
            fetchPriority={index < 8 ? "high" : "auto"}
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
          <span>{image.category}</span>
          <span>{getImageDateLabel(image.capturedAt)}</span>
        </div>
      </div>
    </motion.button>
  );
}

export default function MasonryGallery({ images }: MasonryGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showIntro, setShowIntro] = useState(true);

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
      <AnimatePresence>
        {showIntro ? (
          <motion.div
            className="fixed inset-0 z-60 grid place-items-center bg-[#111816]
              text-[#f7f8f4]"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.55 } }}
          >
            <motion.div
              className="grid place-items-center gap-4"
              initial={{ opacity: 0, scale: 0.9, filter: "blur(12px)" }}
              animate={{
                opacity: [0, 1, 1, 0],
                scale: [0.9, 1, 1.02, 1.08],
                filter: ["blur(12px)", "blur(0px)", "blur(0px)", "blur(8px)"],
              }}
              transition={{ duration: 2, times: [0, 0.24, 0.82, 1] }}
              onAnimationComplete={() => setShowIntro(false)}
            >
              <IntroMark />
              <motion.p
                className="text-sm font-bold tracking-[0.36em] text-[#dbe5e1]
                  uppercase"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28, duration: 0.5, ease: smoothEase }}
              >
                Photery
              </motion.p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {images.length > 0 ? (
        <section className="columns-2 gap-3 sm:gap-4 md:columns-3 lg:columns-4">
          {images.map((image, index) => (
            <GalleryCard
              key={image.driveFileId}
              image={image}
              index={index}
              onOpen={() => setActiveIndex(index)}
            />
          ))}
        </section>
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
