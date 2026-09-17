"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import IntroOverlay from "./IntroOverlay";

export default function GalleryIntro({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!active) return;
    // ストリーミング到着後、現在の画面内の画像のデコードを待つ。
    const check = () => {
      const root = content.current;
      if (!root || !root.querySelector("[data-gallery-ready], [role=alert]"))
        return;
      const visible = Array.from(
        root.querySelectorAll<HTMLElement>("[data-private-image]"),
      ).filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top < innerHeight &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.right > 0
        );
      });
      setReady(
        visible.every((element) => element.dataset.privateImage !== "loading"),
      );
    };
    const timer = window.setInterval(check, 100);
    check();
    return () => window.clearInterval(timer);
  }, [active]);

  return (
    <>
      {active ? (
        <IntroOverlay ready={ready} onComplete={() => setActive(false)} />
      ) : null}
      <div ref={content} inert={active}>
        {children}
      </div>
    </>
  );
}
