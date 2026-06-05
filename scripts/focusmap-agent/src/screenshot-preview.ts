import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const PREVIEW_MAX_BYTES = 800 * 1024;
const THUMBNAIL_MAX_BYTES = 120 * 1024;
const PREVIEW_WIDTHS = [1440, 1080, 900, 720];
const THUMBNAIL_WIDTHS = [360, 280, 220];
const WEBP_QUALITIES = [72, 64, 56, 48, 40];

export interface ScreenshotPreviewBundle {
  originalPath: string;
  localOriginalPathHash: string;
  capturedAt: string;
  width: number | null;
  height: number | null;
  previewWebp: Buffer;
  thumbnailWebp: Buffer;
}

function safeTaskId(taskId: string) {
  return taskId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'task';
}

function extensionForContentType(contentType: string | undefined) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'png';
}

function timestampForPath(iso: string) {
  return iso.replace(/[:.]/g, '-');
}

async function encodeWebpUnderLimit(input: Buffer, widths: number[], maxBytes: number) {
  let smallest: Buffer | null = null;
  for (const width of widths) {
    for (const quality of WEBP_QUALITIES) {
      const candidate = await sharp(input)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      smallest = candidate;
      if (candidate.byteLength <= maxBytes) return candidate;
    }
  }
  return smallest ?? Buffer.alloc(0);
}

export async function createScreenshotPreviewBundle(input: {
  taskId: string;
  image: Buffer;
  contentType?: string;
  capturedAt?: string;
  rootDir?: string;
}): Promise<ScreenshotPreviewBundle> {
  const capturedAt = input.capturedAt && !Number.isNaN(Date.parse(input.capturedAt))
    ? new Date(input.capturedAt).toISOString()
    : new Date().toISOString();
  const metadata = await sharp(input.image).metadata();
  const taskDir = path.join(input.rootDir ?? path.join(homedir(), '.focusmap', 'screenshots'), safeTaskId(input.taskId));
  await mkdir(taskDir, { recursive: true });

  const originalDigest = createHash('sha256').update(input.image).digest('hex');
  const originalPath = path.join(
    taskDir,
    `${timestampForPath(capturedAt)}-${originalDigest.slice(0, 16)}.${extensionForContentType(input.contentType)}`,
  );
  await writeFile(originalPath, input.image);

  const previewWebp = await encodeWebpUnderLimit(input.image, PREVIEW_WIDTHS, PREVIEW_MAX_BYTES);
  const thumbnailWebp = await encodeWebpUnderLimit(input.image, THUMBNAIL_WIDTHS, THUMBNAIL_MAX_BYTES);
  const localOriginalPathHash = createHash('sha256').update(originalPath).digest('hex');

  return {
    originalPath,
    localOriginalPathHash,
    capturedAt,
    width: typeof metadata.width === 'number' ? metadata.width : null,
    height: typeof metadata.height === 'number' ? metadata.height : null,
    previewWebp,
    thumbnailWebp,
  };
}
