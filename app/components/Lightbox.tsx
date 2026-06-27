"use client";

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { GalleryImage } from "./gallery-types";

interface LightboxProps {
  image: GalleryImage | null;
  currentIndex: number | null;
  totalCount: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

interface IconButtonProps {
  label: string;
  className: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

const smoothEase = [0.22, 1, 0.36, 1] as const;
const swipeOffsetThreshold = 80;
const swipeVelocityThreshold = 420;

function IconButton({ label, className, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid h-11 w-11 place-items-center rounded-full border
        border-white/20 bg-white/10 text-white shadow-lg backdrop-blur-md
        transition hover:bg-white/20 focus-visible:outline-2
        focus-visible:outline-white/70 ${className}`}
    >
      {children}
    </button>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none">
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none">
      <path
        d="m15 18-6-6 6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none">
      <path
        d="m9 18 6-6-6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export default function Lightbox({
  image,
  currentIndex,
  totalCount,
  onClose,
  onPrevious,
  onNext,
}: LightboxProps) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setPortalRoot(document.body);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (!image) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "ArrowLeft") {
        onPrevious();
      }
      if (event.key === "ArrowRight") {
        onNext();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [image, onClose, onNext, onPrevious]);

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    const hasSwipeDistance = Math.abs(info.offset.x) > swipeOffsetThreshold;
    const hasSwipeVelocity = Math.abs(info.velocity.x) > swipeVelocityThreshold;

    if (!hasSwipeDistance && !hasSwipeVelocity) {
      return;
    }

    if (info.offset.x > 0) {
      onPrevious();
    } else {
      onNext();
    }
  };

  if (!portalRoot) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {image ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={image.name}
          className="fixed inset-0 z-70 bg-zinc-950/85 text-white
            backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
        >
          <IconButton
            label="Close lightbox"
            className="absolute top-4 right-4 z-20"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <XIcon />
          </IconButton>

          {totalCount > 1 ? (
            <>
              <IconButton
                label="Previous image"
                className="absolute top-1/2 left-4 z-20 hidden -translate-y-1/2
                  md:grid"
                onClick={(event) => {
                  event.stopPropagation();
                  onPrevious();
                }}
              >
                <ChevronLeftIcon />
              </IconButton>
              <IconButton
                label="Next image"
                className="absolute top-1/2 right-4 z-20 hidden -translate-y-1/2
                  md:grid"
                onClick={(event) => {
                  event.stopPropagation();
                  onNext();
                }}
              >
                <ChevronRightIcon />
              </IconButton>
            </>
          ) : null}

          <div
            className="grid h-full grid-rows-[1fr_auto] gap-4 px-4 py-16
              md:px-20"
          >
            <motion.div
              key={image.driveFileId}
              className="relative min-h-0 cursor-grab overflow-hidden rounded-md
                bg-black/25 active:cursor-grabbing"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.16}
              onDragEnd={handleDragEnd}
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.28, ease: smoothEase }}
              onClick={(event) => event.stopPropagation()}
            >
              {image.imageUrl ? (
                <Image
                  src={image.imageUrl}
                  alt={image.name}
                  fill
                  sizes="100vw"
                  className="object-contain"
                  priority
                  unoptimized
                />
              ) : (
                <div
                  className="flex h-full items-center justify-center
                    text-zinc-300"
                >
                  No Image
                </div>
              )}
            </motion.div>
            <div className="mx-auto grid max-w-3xl gap-1 text-center">
              <p className="text-sm font-medium text-zinc-300">
                {currentIndex === null
                  ? ""
                  : `${currentIndex + 1} / ${totalCount}`}
              </p>
              <h2 className="truncate text-lg font-semibold">{image.name}</h2>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    portalRoot,
  );
}
