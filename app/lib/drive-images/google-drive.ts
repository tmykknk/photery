import "server-only";

import { google } from "googleapis";

export interface DriveImageFile {
  id: string;
  name: string | null;
  thumbnailLink: string | null;
  tags: string[];
  folderOrder: number;
}

interface DriveImageMetadata {
  id: string;
  name: string | null;
  thumbnailLink: string | null;
}

export type GoogleDriveAuth = ReturnType<typeof createDriveAuth>;

export function createDriveAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n").replace(
    /"/g,
    "",
  );

  if (!email || !key) {
    throw new Error("Google Drive service account credentials are missing.");
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

export function createDriveClient(auth: GoogleDriveAuth) {
  return google.drive({ version: "v3", auth });
}

export function getDriveFolderIds(): string[] {
  return (process.env.GOOGLE_DRIVE_FOLDER_ID ?? "")
    .split(",")
    .map((folderId) => folderId.trim())
    .filter((folderId) => folderId.length > 0);
}

function isDriveImageFile(file: {
  id?: string | null;
  name?: string | null;
  thumbnailLink?: string | null;
}): file is DriveImageMetadata {
  return typeof file.id === "string" && file.id.length > 0;
}

export async function listDriveImagesInFolders(
  folderIds: string[],
): Promise<DriveImageFile[]> {
  const auth = createDriveAuth();
  const drive = createDriveClient(auth);
  const filesById = new Map<string, DriveImageFile>();

  for (const [folderOrder, folderId] of folderIds.entries()) {
    const folderResponse = await drive.files.get({
      fileId: folderId,
      fields: "id, name",
      supportsAllDrives: true,
    });
    const folderName = folderResponse.data.name?.trim();

    if (!folderName) {
      throw new Error(`Google Drive folder name is missing: ${folderId}`);
    }

    let pageToken: string | undefined;

    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
        fields: "nextPageToken, files(id, name, thumbnailLink)",
        pageSize: 1000,
        pageToken,
      });

      for (const file of res.data.files ?? []) {
        if (isDriveImageFile(file)) {
          const existingFile = filesById.get(file.id);

          if (existingFile) {
            if (!existingFile.tags.includes(folderName)) {
              existingFile.tags.push(folderName);
            }
            existingFile.folderOrder = Math.min(
              existingFile.folderOrder,
              folderOrder,
            );
          } else {
            filesById.set(file.id, {
              ...file,
              tags: [folderName],
              folderOrder,
            });
          }
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return [...filesById.values()];
}
