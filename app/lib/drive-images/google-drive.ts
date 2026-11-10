import "server-only";

import {
  getDriveAccessToken,
  type DriveCredentials,
} from "../../../shared/drive-media.ts";

export interface DriveImageFile {
  id: string;
  name: string | null;
  tags: string[];
  folderOrder: number;
  width: number | null;
  height: number | null;
}

interface DriveImageMetadata {
  id: string;
  name?: string | null;
  imageMediaMetadata?: {
    width?: number | null;
    height?: number | null;
    rotation?: number | null;
  } | null;
}

export type GoogleDriveAuth = DriveCredentials;

export function createDriveAuth(): GoogleDriveAuth {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email?.trim() || !privateKey?.trim()) {
    throw new Error("Google Drive service account credentials are missing.");
  }

  return { email, privateKey };
}

// 1回の同期内でアクセストークンを共有し、Google の固定エンドポイントだけに送る。
export async function createDriveClient(auth: GoogleDriveAuth) {
  const token = await getDriveAccessToken(auth);

  return async (path: string, params: URLSearchParams) => {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files${path}?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
        cache: "no-store",
      },
    );

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Google Drive request failed (${response.status}).`);
    }

    const value: unknown = await response.json();
    if (!isRecord(value)) {
      throw new Error("Google Drive returned invalid metadata.");
    }
    return value;
  };
}

export function getDriveFolderIds(): string[] {
  return (process.env.GOOGLE_DRIVE_FOLDER_ID ?? "")
    .split(",")
    .map((folderId) => folderId.trim())
    .filter((folderId) => folderId.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalInteger(value: unknown): boolean {
  return value === undefined || value === null || Number.isInteger(value);
}

function isDriveImageFile(file: unknown): file is DriveImageMetadata {
  if (
    !isRecord(file) ||
    typeof file.id !== "string" ||
    file.id.length === 0 ||
    (file.name !== undefined &&
      file.name !== null &&
      typeof file.name !== "string")
  ) {
    return false;
  }

  const metadata = file.imageMediaMetadata;
  return (
    metadata === undefined ||
    metadata === null ||
    (isRecord(metadata) &&
      isOptionalInteger(metadata.width) &&
      isOptionalInteger(metadata.height) &&
      isOptionalInteger(metadata.rotation))
  );
}

export async function listDriveImagesInFolders(
  folderIds: string[],
): Promise<DriveImageFile[]> {
  const drive = await createDriveClient(createDriveAuth());
  const filesById = new Map<string, DriveImageFile>();

  for (const [folderOrder, folderId] of folderIds.entries()) {
    const folder = await drive(
      `/${encodeURIComponent(folderId)}`,
      new URLSearchParams({ fields: "id,name", supportsAllDrives: "true" }),
    );
    const folderName =
      typeof folder.name === "string" ? folder.name.trim() : "";
    if (!folderName) {
      throw new Error("Google Drive folder name is missing.");
    }

    let pageToken: string | undefined;
    const seenPageTokens = new Set<string>();

    do {
      const escapedFolderId = folderId
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
      const params = new URLSearchParams({
        q: `'${escapedFolderId}' in parents and mimeType contains 'image/' and trashed = false`,
        fields:
          "nextPageToken,incompleteSearch,files(id,name,imageMediaMetadata(width,height,rotation))",
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await drive("", params);

      // 欠けた一覧や不正なレコードは、削除対象の判定に使わず同期全体を中止する。
      if (
        !Array.isArray(page.files) ||
        (page.incompleteSearch !== undefined &&
          page.incompleteSearch !== false) ||
        (page.nextPageToken !== undefined &&
          (typeof page.nextPageToken !== "string" ||
            page.nextPageToken.length === 0))
      ) {
        throw new Error(
          "Google Drive returned an invalid or incomplete file list.",
        );
      }

      for (const file of page.files) {
        if (!isDriveImageFile(file)) {
          throw new Error("Google Drive returned invalid image metadata.");
        }
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
          const metadata = file.imageMediaMetadata;
          const rotated = (metadata?.rotation ?? 0) % 2 !== 0;
          filesById.set(file.id, {
            id: file.id,
            name: file.name ?? null,
            tags: [folderName],
            folderOrder,
            width: (rotated ? metadata?.height : metadata?.width) ?? null,
            height: (rotated ? metadata?.width : metadata?.height) ?? null,
          });
        }
      }

      pageToken = page.nextPageToken as string | undefined;
      if (pageToken) {
        if (seenPageTokens.has(pageToken)) {
          throw new Error("Google Drive returned a repeated page token.");
        }
        seenPageTokens.add(pageToken);
      }
    } while (pageToken);
  }

  return [...filesById.values()];
}
