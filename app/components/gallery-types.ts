export interface GalleryImage {
  driveFileId: string;
  name: string;
  originalFileName: string;
  thumbnailUrl: string;
  tags: string[];
  folderOrder: number;
  capturedAt: string | null;
}
