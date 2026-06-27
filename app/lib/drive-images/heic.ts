import "server-only";

import sharp from "sharp";
import { Readable } from "node:stream";

const maxHeicInputBytes = 80 * 1024 * 1024;

export function isHeicImage(
  contentType: string,
  fileName: string | null,
): boolean {
  const normalizedContentType = contentType.toLowerCase();
  const normalizedFileName = fileName?.toLowerCase() ?? "";

  return (
    normalizedContentType.includes("image/heic") ||
    normalizedContentType.includes("image/heif") ||
    /\.hei[cf]$/i.test(normalizedFileName)
  );
}

async function readableToBuffer(
  stream: Readable,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    let buffer: Buffer | null = null;

    if (Buffer.isBuffer(chunk)) {
      buffer = chunk;
    } else if (chunk instanceof Uint8Array) {
      buffer = Buffer.from(chunk);
    } else if (typeof chunk === "string") {
      buffer = Buffer.from(chunk);
    }

    if (!buffer) {
      continue;
    }

    totalBytes += buffer.byteLength;

    if (totalBytes > maxBytes) {
      throw new Error("HEIC image is too large to convert safely.");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export async function convertHeicToWebp(stream: Readable): Promise<Buffer> {
  const input = await readableToBuffer(stream, maxHeicInputBytes);

  // HEIC files from Apple Photos can exceed libheif's conservative iref limits.
  // The byte cap above keeps conversion bounded before relaxing HEIF parser limits.
  return sharp(input, { autoOrient: true, unlimited: true })
    .webp({ quality: 86, effort: 4 })
    .toBuffer();
}

export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);

  return arrayBuffer;
}
