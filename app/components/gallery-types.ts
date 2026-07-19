export interface GalleryImage {
  driveFileId: string;
  name: string;
  thumbnailUrl: string;
  tags: string[];
  folderOrder: number;
  capturedAt: string | null;
}
