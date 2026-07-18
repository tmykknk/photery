export interface GalleryImage {
  driveFileId: string;
  name: string;
  imageUrl: string;
  thumbnailUrl: string;
  tags: string[];
  capturedAt: string | null;
}
