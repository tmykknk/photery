"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { displayImageCache } from "./display-image-cache";

interface PrivateImageProps {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  canRetry?: boolean;
}

export default function PrivateImage({
  src,
  alt,
  className,
  eager = false,
  canRetry = false,
}: PrivateImageProps) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ url: string; error: boolean }>({
    url: "",
    error: false,
  });
  const [retry, setRetry] = useState(0);
  const [decodedUrl, setDecodedUrl] = useState("");
  const lastDecodedSrc = useRef("");
  const [fadeIn, setFadeIn] = useState(true);
  const leaseRef = useRef<ReturnType<typeof displayImageCache.acquire> | null>(
    null,
  );

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let lease: ReturnType<typeof displayImageCache.acquire> | null = null;
    let disposed = false;
    let invalidated = false;
    let loaded = false;

    const load = () => {
      if (disposed || lease) return;
      invalidated = false;
      const bounds = element.getBoundingClientRect();
      const current = displayImageCache.acquire(
        src,
        eager || (bounds.top < window.innerHeight && bounds.bottom > 0),
        () => {
          if (!disposed && lease === current) {
            invalidated = true;
            setState({ url: "", error: true });
          }
        },
      );
      lease = current;
      leaseRef.current = current;
      void current.promise
        .then((url) => {
          if (disposed || invalidated || lease !== current) return;
          // 表示済み画像は一覧を離れるまで保持し、スクロールで取得し直さない。
          loaded = true;
          intersection.disconnect();
          // 同じ画像へ戻ったときは、再取得後もフェードを繰り返さない。
          setFadeIn(lastDecodedSrc.current !== src);
          setState({ url, error: false });
        })
        .catch(() => {
          if (!disposed && !invalidated && lease === current)
            setState({ url: "", error: true });
        });
    };
    const intersection = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) load();
        else if (!loaded) {
          // 読み込み中の画像だけは、画面外へ離れたら利用を解除する。
          lease?.release();
          lease = null;
          leaseRef.current = null;
        }
      },
      { rootMargin: "200px" },
    );
    intersection.observe(element);
    const frame = requestAnimationFrame(() => {
      if (eager) load();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      lease?.release();
      leaseRef.current = null;
      intersection.disconnect();
    };
  }, [src, eager, retry]);

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
        <div
          className={`absolute inset-0 ${
            fadeIn
              ? `transition-opacity duration-300 ease-out
                motion-reduce:transition-none`
              : ""
            } ${decodedUrl === state.url ? "opacity-100" : "opacity-0"}`}
        >
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
                if (element.isConnected && element.src === url) {
                  lastDecodedSrc.current = src;
                  setDecodedUrl(url);
                }
              } catch {
                if (element.isConnected && element.src === url)
                  setState((current) =>
                    current.url === url ? { ...current, error: true } : current,
                  );
              }
            }}
            onError={() =>
              setState((current) =>
                current.url === state.url
                  ? { ...current, error: true }
                  : current,
              )
            }
            className={className}
          />
        </div>
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
                leaseRef.current?.invalidate();
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
