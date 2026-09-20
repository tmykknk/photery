"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import PrivateImage from "./PrivateImage";
import type { GalleryImage } from "./gallery-types";

interface ZoomableImageProps {
  image: GalleryImage;
  onPrevious: () => void;
  onNext: () => void;
}

interface Point {
  x: number;
  y: number;
}
interface Transform extends Point {
  scale: number;
}
interface Gesture {
  start: Point;
  transform: Transform;
  time: number;
  moved: boolean;
  multiple: boolean;
  distance: number;
}

export default function ZoomableImage({
  image,
  onPrevious,
  onNext,
}: ZoomableImageProps) {
  const container = useRef<HTMLDivElement>(null);
  const size = useRef({ width: 0, height: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<(Point & { time: number }) | null>(null);
  const lastPointerType = useRef("");
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    x: 0,
    y: 0,
  });

  // 倍率を保持し、画面サイズに収まる範囲へ移動量だけを補正する。
  function update(next: Transform) {
    const scale = Math.max(1, Math.min(4.5, next.scale));
    const limitX = (size.current.width * (scale - 1)) / 2;
    const limitY = (size.current.height * (scale - 1)) / 2;
    const value = {
      scale,
      x: Math.max(-limitX, Math.min(limitX, next.x)),
      y: Math.max(-limitY, Math.min(limitY, next.y)),
    };
    transformRef.current = value;
    setTransform(value);
  }

  function toggleZoom() {
    update({ scale: transformRef.current.scale > 1 ? 1 : 2.5, x: 0, y: 0 });
  }

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      size.current = {
        width: element.clientWidth,
        height: element.clientHeight,
      };
      update(transformRef.current);
      pointers.current.clear();
      gesture.current = null;
      lastTap.current = null;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function begin(multiple: boolean) {
    const [first, second] = [...pointers.current.values()];
    if (!first) {
      gesture.current = null;
      return;
    }
    gesture.current = {
      start: second
        ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        : first,
      transform: { ...transformRef.current },
      time: performance.now(),
      moved: false,
      multiple,
      distance: second ? Math.hypot(first.x - second.x, first.y - second.y) : 0,
    };
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    lastPointerType.current = event.pointerType;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const multiple =
      pointers.current.size > 1 || Boolean(gesture.current?.multiple);
    if (multiple) lastTap.current = null;
    begin(multiple);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const current = gesture.current;
    const [first, second] = [...pointers.current.values()];
    if (!current || !first) return;
    if (second) {
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const scale =
        current.distance > 0
          ? (current.transform.scale * distance) / current.distance
          : current.transform.scale;
      update({ ...current.transform, scale });
      return;
    }
    const dx = first.x - current.start.x;
    const dy = first.y - current.start.y;
    if (Math.hypot(dx, dy) > 10) current.moved = true;
    if (current.transform.scale > 1) {
      update({
        scale: current.transform.scale,
        x: current.transform.x + dx,
        y: current.transform.y + dy,
      });
    }
  }

  // タップは指を離した時に確定し、ピンチやスワイプを混同しない。
  function pointerEnd(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!pointers.current.has(event.pointerId)) return;
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (cancelled) lastTap.current = null;
    if (
      !cancelled &&
      current &&
      !current.multiple &&
      pointers.current.size === 0
    ) {
      const dx = event.clientX - current.start.x;
      const dy = event.clientY - current.start.y;
      const time = performance.now();
      const elapsed = time - current.time;
      const tap = !current.moved && Math.hypot(dx, dy) <= 10 && elapsed <= 300;
      if (tap && event.pointerType !== "mouse") {
        const previous = lastTap.current;
        if (
          previous &&
          time - previous.time <= 300 &&
          Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <=
            35
        ) {
          lastTap.current = null;
          toggleZoom();
        } else lastTap.current = { time, x: event.clientX, y: event.clientY };
      } else {
        lastTap.current = null;
        if (
          current.transform.scale === 1 &&
          Math.abs(dx) > Math.abs(dy) &&
          (Math.abs(dx) > 80 ||
            (Math.abs(dx) > 10 &&
              (Math.abs(dx) / Math.max(elapsed, 1)) * 1000 > 420))
        ) {
          if (dx > 0) onPrevious();
          else onNext();
        }
      }
    }
    begin(true);
  }

  return (
    <div
      ref={container}
      className="relative h-full min-h-0 w-full touch-none overflow-hidden
        rounded-md bg-zinc-950 select-none"
      style={{
        cursor: transform.scale > 1 ? "grab" : "zoom-in",
        WebkitTouchCallout: "none",
      }}
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(event) => pointerEnd(event)}
      onPointerCancel={(event) => pointerEnd(event, true)}
      onLostPointerCapture={(event) => pointerEnd(event, true)}
      onDoubleClick={() => {
        if (lastPointerType.current === "mouse") toggleZoom();
      }}
    >
      <div
        className="relative h-full w-full"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        {image.lightboxUrl || image.thumbnailUrl ? (
          <PrivateImage
            src={image.lightboxUrl || image.thumbnailUrl}
            alt={image.name}
            className="object-contain"
            eager
            canRetry
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-300">
            No Image
          </div>
        )}
      </div>
    </div>
  );
}
