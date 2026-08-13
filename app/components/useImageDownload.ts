import { useCallback, useState, type MouseEvent } from "react";
import type { GalleryImage } from "./gallery-types";

function getDownloadFileName(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;

  const utf8FileName = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8FileName?.[1]) {
    try {
      return decodeURIComponent(utf8FileName[1]);
    } catch {
      return null;
    }
  }

  const fallbackFileName = contentDisposition.match(/filename="?([^";]+)"?/i);
  return fallbackFileName?.[1] ?? null;
}

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

        const fileName =
          getDownloadFileName(response.headers.get("Content-Disposition")) ??
          image.originalFileName;
        const file = new File([await response.blob()], fileName, {
          type: response.headers.get("Content-Type") ?? "image/jpeg",
        });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: image.name });
          return;
        }

        const objectUrl = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName;
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
