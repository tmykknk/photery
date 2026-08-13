import { useCallback, useState, type MouseEvent } from "react";
import type { GalleryImage } from "./gallery-types";

export function useImageDownload(image: GalleryImage | null) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!image || isDownloading) return;

      setIsDownloading(true);
      const downloadUrl = `/api/images/${encodeURIComponent(image.driveFileId)}?download=1`;

      try {
        const response = await fetch(downloadUrl);

        if (!response.ok) {
          throw new Error("Image download failed.");
        }

        const file = new File([await response.blob()], image.name, {
          type: response.headers.get("Content-Type") ?? "image/jpeg",
        });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: image.name });
          return;
        }

        const objectUrl = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = image.name;
        link.click();
        URL.revokeObjectURL(objectUrl);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("Image download failed:", error);
        window.location.assign(downloadUrl);
      } finally {
        setIsDownloading(false);
      }
    },
    [image, isDownloading],
  );

  return { handleDownload, isDownloading };
}
