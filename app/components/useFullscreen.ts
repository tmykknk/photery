import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type MouseEvent,
  type RefObject,
} from "react";

export function useFullscreen(
  lightboxRef: RefObject<HTMLElement | null>,
  open: boolean,
) {
  const active = useRef(open);
  const ownedElement = useRef<HTMLElement | null>(null);
  const lastExit = useRef(-Infinity);
  const [isFullscreenAvailable] = useState(
    () => typeof document !== "undefined" && document.fullscreenEnabled,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let wasFullscreen = false;
    const updateFullscreenState = () => {
      const current =
        Boolean(lightboxRef.current) &&
        document.fullscreenElement === lightboxRef.current;
      if (wasFullscreen && !current) lastExit.current = performance.now();
      wasFullscreen = current;
      setIsFullscreen(current);
    };

    document.addEventListener("fullscreenchange", updateFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, [lightboxRef]);

  useEffect(() => {
    active.current = open;
    const element = lightboxRef.current;
    return () => {
      active.current = false;
      const target = ownedElement.current ?? element;
      if (target && document.fullscreenElement === target) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [open, lightboxRef]);

  const handleFullscreen = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      try {
        if (document.fullscreenElement === lightboxRef.current) {
          await document.exitFullscreen();
        } else {
          const element = lightboxRef.current;
          if (!element || !active.current) return;
          ownedElement.current = element;
          await element.requestFullscreen({ navigationUI: "hide" });
          if (!active.current && document.fullscreenElement === element)
            await document.exitFullscreen();
        }
      } catch (error: unknown) {
        console.error("Unable to change fullscreen mode:", error);
      }
    },
    [lightboxRef],
  );

  const shouldIgnoreEscape = useCallback(
    () =>
      Boolean(document.fullscreenElement) ||
      performance.now() - lastExit.current < 300,
    [],
  );

  return {
    handleFullscreen,
    isFullscreen,
    isFullscreenAvailable,
    shouldIgnoreEscape,
  };
}
