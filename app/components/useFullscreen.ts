import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";

export function useFullscreen(lightboxRef: RefObject<HTMLElement | null>) {
  const [isFullscreenAvailable] = useState(
    () => typeof document !== "undefined" && document.fullscreenEnabled,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === lightboxRef.current);
    };

    document.addEventListener("fullscreenchange", updateFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, [lightboxRef]);

  const handleFullscreen = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      try {
        if (document.fullscreenElement === lightboxRef.current) {
          await document.exitFullscreen();
        } else {
          await lightboxRef.current?.requestFullscreen();
        }
      } catch (error: unknown) {
        console.error("Unable to change fullscreen mode:", error);
      }
    },
    [lightboxRef],
  );

  return { handleFullscreen, isFullscreen, isFullscreenAvailable };
}
