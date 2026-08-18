"use client";

import { motion, type PanInfo } from "framer-motion";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryImage } from "./gallery-types";

interface ZoomableImageProps {
  image: GalleryImage;
  onPrevious: () => void;
  onNext: () => void;
}

const smoothEase = [0.22, 1, 0.36, 1] as const;
const swipeOffsetThreshold = 80;
const swipeVelocityThreshold = 420;

export default function ZoomableImage({
  image,
  onPrevious,
  onNext,
}: ZoomableImageProps) {
  const [scale, setScale] = useState(1);
  const [isInteracting, setIsInteracting] = useState(false);
  const scaleRef = useRef(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({
    width: 360,
    height: 600,
  });

  const isZoomed = scale > 1.05;
  const panLimitX = (scale - 1) * (containerSize.width / 2);
  const panLimitY = (scale - 1) * (containerSize.height / 2);

  const updateScale = useCallback((nextScale: number) => {
    scaleRef.current = nextScale;
    setScale(nextScale);
  }, []);

  const resetZoom = useCallback(() => {
    updateScale(1);
    setIsInteracting(false);
  }, [updateScale]);

  const toggleZoom = useCallback(() => {
    if (scale > 1.2) {
      resetZoom();
    } else {
      updateScale(2.5);
    }
  }, [scale, resetZoom, updateScale]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const touchStateRef = useRef<{
    initialDist: number;
    initialScale: number;
    isPinching: boolean;
  } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(
    null,
  );

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const firstTouch = event.touches[0];
      const secondTouch = event.touches[1];
      if (!firstTouch || !secondTouch) return;

      setIsInteracting(true);
      touchStateRef.current = {
        initialDist: Math.hypot(
          firstTouch.clientX - secondTouch.clientX,
          firstTouch.clientY - secondTouch.clientY,
        ),
        initialScale: scaleRef.current,
        isPinching: true,
      };
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;

    const now = Date.now();
    if (
      lastTapRef.current &&
      now - lastTapRef.current.time < 300 &&
      Math.hypot(
        touch.clientX - lastTapRef.current.x,
        touch.clientY - lastTapRef.current.y,
      ) < 35
    ) {
      toggleZoom();
      lastTapRef.current = null;
      return;
    }

    lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const touchState = touchStateRef.current;
    const firstTouch = event.touches[0];
    const secondTouch = event.touches[1];
    if (!touchState?.isPinching || !firstTouch || !secondTouch) return;

    const distance = Math.hypot(
      firstTouch.clientX - secondTouch.clientX,
      firstTouch.clientY - secondTouch.clientY,
    );
    const nextScale = Math.min(
      Math.max(
        (distance / touchState.initialDist) * touchState.initialScale,
        1,
      ),
      4.5,
    );
    updateScale(nextScale);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStateRef.current?.isPinching) return;

    setIsInteracting(false);
    if (scaleRef.current < 1.05) resetZoom();
    if (event.touches.length === 0) touchStateRef.current = null;
  };

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (isZoomed) return;
    const hasSwipeDistance = Math.abs(info.offset.x) > swipeOffsetThreshold;
    const hasSwipeVelocity = Math.abs(info.velocity.x) > swipeVelocityThreshold;
    if (!hasSwipeDistance && !hasSwipeVelocity) return;

    if (info.offset.x > 0) onPrevious();
    else onNext();
  };

  return (
    <motion.div
      ref={containerRef}
      className="relative h-full min-h-0 w-full touch-auto overflow-hidden
        rounded-md bg-zinc-950 select-none"
      style={{ cursor: "grab", WebkitTouchCallout: "default" }}
      drag={isZoomed ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.16}
      onDragEnd={isZoomed ? undefined : handleDragEnd}
      initial={{ opacity: 0, scale: 0.96, y: 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.28, ease: smoothEase }}
      onClick={(event) => event.stopPropagation()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={toggleZoom}
    >
      <motion.div
        className="relative flex h-full w-full items-center justify-center"
        drag={isZoomed}
        dragConstraints={{
          left: -panLimitX,
          right: panLimitX,
          top: -panLimitY,
          bottom: panLimitY,
        }}
        dragElastic={0.12}
        animate={{
          scale,
          x: isZoomed ? undefined : 0,
          y: isZoomed ? undefined : 0,
        }}
        transition={
          isInteracting
            ? { duration: 0 }
            : { type: "spring", stiffness: 300, damping: 30 }
        }
      >
        {image.lightboxUrl || image.thumbnailUrl ? (
          <Image
            src={image.lightboxUrl || image.thumbnailUrl}
            alt={image.name}
            fill
            sizes="100vw"
            className="object-contain"
            priority
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-300">
            No Image
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
