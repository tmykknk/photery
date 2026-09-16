"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowButton,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FullscreenIcon,
  IconButton,
} from "./LightboxControls";
import type { GalleryImage } from "./gallery-types";
import { useFullscreen } from "./useFullscreen";
import { useImageDownload } from "./useImageDownload";
import ZoomableImage from "./ZoomableImage";

interface LightboxProps {
  image: GalleryImage | null;
  currentIndex: number | null;
  totalCount: number;
  navigationStatus?: string;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

export default function Lightbox({
  image,
  currentIndex,
  totalCount,
  navigationStatus,
  onClose,
  onPrevious,
  onNext,
}: LightboxProps) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const imageViewportRef = useRef<HTMLDivElement>(null);
  const { handleDownload, isDownloading } = useImageDownload(image);
  const { handleFullscreen, isFullscreen, isFullscreenAvailable } =
    useFullscreen(imageViewportRef);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setPortalRoot(document.body);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (!image) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [image, onClose, onNext, onPrevious]);

  if (!portalRoot) return null;

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
            <CloseIcon />
          </IconButton>

          {isFullscreenAvailable ? (
            <IconButton
              label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="absolute right-4 bottom-19 z-20"
              onClick={handleFullscreen}
            >
              <FullscreenIcon isFullscreen={isFullscreen} />
            </IconButton>
          ) : null}

          <button
            type="button"
            aria-label={`${image.name}をダウンロード`}
            disabled={isDownloading}
            className="absolute right-4 bottom-4 z-20 grid h-11 w-11
              place-items-center rounded-full border border-white/20 bg-white/10
              text-white shadow-lg backdrop-blur-md transition hover:bg-white/20
              focus-visible:outline-2 focus-visible:outline-white/70
              disabled:cursor-wait disabled:opacity-60"
            onClick={handleDownload}
          >
            <DownloadIcon />
          </button>

          <div
            className="grid h-full grid-rows-[1fr_auto] gap-4 px-4 py-16
              md:px-20"
          >
            <div
              ref={imageViewportRef}
              className="relative h-full min-h-0 w-full bg-zinc-950"
            >
              <ZoomableImage
                key={image.driveFileId}
                image={image}
                onPrevious={onPrevious}
                onNext={onNext}
              />
              {isFullscreen ? (
                <IconButton
                  label="Exit fullscreen"
                  className="absolute right-4 bottom-4 z-20"
                  onClick={handleFullscreen}
                >
                  <FullscreenIcon isFullscreen />
                </IconButton>
              ) : null}
            </div>
            <div
              className="mx-auto grid w-full max-w-3xl gap-2 text-center"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-center gap-4">
                {totalCount > 1 ? (
                  <ArrowButton
                    label="Previous image"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPrevious();
                    }}
                  >
                    <ChevronLeftIcon />
                  </ArrowButton>
                ) : null}
                <p className="min-w-24 text-sm font-medium text-zinc-300">
                  {currentIndex === null
                    ? ""
                    : `${currentIndex + 1} / ${totalCount}`}
                </p>
                {totalCount > 1 ? (
                  <ArrowButton
                    label="Next image"
                    onClick={(event) => {
                      event.stopPropagation();
                      onNext();
                    }}
                  >
                    <ChevronRightIcon />
                  </ArrowButton>
                ) : null}
              </div>
              <h2 className="truncate text-lg font-semibold">{image.name}</h2>
              {navigationStatus ? (
                <p role="status" className="text-sm text-zinc-300">
                  {navigationStatus}
                </p>
              ) : null}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    portalRoot,
  );
}
