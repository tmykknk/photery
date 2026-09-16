export interface GalleryImage {
  driveFileId: string;
  name: string;
  originalFileName: string;
  thumbnailUrl: string;
  lightboxUrl: string;
  tags: string[];
  folderOrder: number;
  capturedAt: string | null;
  aspectRatio?: number;
}

export interface GalleryPage {
  images: GalleryImage[];
  nextOffset: number | null;
  totalCount: number;
}
