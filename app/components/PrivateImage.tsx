"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { imageClient } from "./image-client";
import { selectImageWidth } from "../../shared/image-protocol";

interface PrivateImageProps {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  canRetry?: boolean;
  aspectRatio?: number;
}

export default function PrivateImage({
  src,
  alt,
  className,
  eager = false,
  canRetry = false,
  aspectRatio,
}: PrivateImageProps) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ url: string; error: boolean }>({
    url: "",
    error: false,
  });
  const [retry, setRetry] = useState(0);
  const [decodedUrl, setDecodedUrl] = useState("");

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let controller: AbortController | null = null;
    let objectUrl = "";
    let visible = eager;
    let disposed = false;
    let loadedWidth = 0;
    const variant = src.includes("variant=card") ? "card" : "lightbox";

    const load = () => {
      if (!visible || disposed) return;
      // Driveの長辺指定に合わせ、coverによる拡大と画面密度を考慮する。
      const { width: boxWidth, height: boxHeight } =
        element.getBoundingClientRect();
      const ratio =
        aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0
          ? aspectRatio
          : undefined;
      const longEdge = ratio
        ? (variant === "card" ? Math.max : Math.min)(
            boxWidth / ratio,
            boxHeight,
          ) * Math.max(ratio, 1)
        : Math.max(boxWidth, boxHeight);
      const width = selectImageWidth(
        variant === "lightbox" || !ratio
          ? 1600
          : longEdge * Math.min(window.devicePixelRatio || 1, 3),
        variant,
      );
      if (width <= loadedWidth) return;
      loadedWidth = width;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void imageClient
        .load(
          `${src}&width=${width}`,
          current.signal,
          false,
          element.getBoundingClientRect().top < window.innerHeight &&
            element.getBoundingClientRect().bottom > 0,
        )
        .then(({ blob }) => {
          if (disposed || current.signal.aborted) return;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(blob);
          setState({ url: objectUrl, error: false });
        })
        .catch(() => {
          if (!disposed && !current.signal.aborted)
            setState({ url: objectUrl, error: true });
        });
    };
    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible) load();
        else {
          controller?.abort();
          controller = null;
          loadedWidth = 0;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = "";
          setState({ url: "", error: false });
        }
      },
      { rootMargin: "200px" },
    );
    const resize = new ResizeObserver(load);
    intersection.observe(element);
    resize.observe(element);
    const frame = requestAnimationFrame(() => {
      if (eager) load();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      controller?.abort();
      intersection.disconnect();
      resize.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, eager, retry, aspectRatio]);

  return (
    <div
      ref={container}
      className="absolute inset-0"
      data-private-image={
        state.error
          ? "error"
          : state.url && decodedUrl === state.url
            ? "ready"
            : "loading"
      }
    >
      {state.url ? (
        <Image
          key={state.url}
          src={state.url}
          alt={alt}
          fill
          unoptimized
          loading="eager"
          onLoad={async (event) => {
            const element = event.currentTarget;
            const url = element.src;
            try {
              await element.decode();
              if (element.isConnected && element.src === url)
                setDecodedUrl(url);
            } catch {
              if (element.isConnected && element.src === url)
                setState((current) =>
                  current.url === url ? { ...current, error: true } : current,
                );
            }
          }}
          onError={() =>
            setState((current) =>
              current.url === state.url ? { ...current, error: true } : current,
            )
          }
          className={className}
        />
      ) : null}
      {state.error ? (
        <div
          className="absolute inset-0 flex items-center justify-center p-3
            text-center text-xs text-zinc-500"
        >
          {canRetry ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setRetry((value) => value + 1);
              }}
            >
              再試行
            </button>
          ) : (
            <span>画像を読み込めません</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
