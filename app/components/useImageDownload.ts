import { useCallback, useState, type MouseEvent } from "react";
import type { GalleryImage } from "./gallery-types";
import { imageClient } from "./image-client";

export function useImageDownload(image: GalleryImage | null) {
  const [isDownloading, setIsDownloading] = useState(false);
  const handleDownload = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!image || isDownloading) return;
      setIsDownloading(true);
      try {
        // 原本はWorkerからだけ取得し、予備転送枠を消費しない。
        const { blob, fileName } = await imageClient.load(
          `/api/images/${encodeURIComponent(image.driveFileId)}?download=1`,
          new AbortController().signal,
          true,
        );
        const file = new File([blob], fileName, { type: blob.type });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: image.name });
            return;
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError")
              return;
            // 共有に失敗しても取得済みBlobを再利用する。
          }
        }
        const objectUrl = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } catch {
        window.alert(
          "画像を保存できませんでした。時間をおいて再試行してください。",
        );
      } finally {
        setIsDownloading(false);
      }
    },
    [image, isDownloading],
  );
  return { handleDownload, isDownloading };
}
