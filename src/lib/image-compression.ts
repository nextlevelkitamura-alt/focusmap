export const MAX_UPLOAD_IMAGE_BYTES = 300 * 1024

type CompressionOptions = {
  maxBytes?: number
  maxDimension?: number
}

function compressedImageName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "image"
  return `${baseName}.jpg`
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return await new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, type, quality)
  })
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(file)
  }

  const image = new Image()
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("画像を読み込めませんでした"))
      image.src = url
    })
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function bitmapSize(bitmap: ImageBitmap | HTMLImageElement) {
  if ("naturalWidth" in bitmap && "naturalHeight" in bitmap) {
    return {
      width: bitmap.naturalWidth,
      height: bitmap.naturalHeight,
    }
  }
  return { width: bitmap.width, height: bitmap.height }
}

export async function compressImageFileForUpload(file: File, options: CompressionOptions = {}) {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_IMAGE_BYTES
  const maxDimension = options.maxDimension ?? 1600
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください")
  }
  if (typeof document === "undefined") {
    throw new Error("画像を圧縮できない環境です")
  }

  const bitmap = await loadBitmap(file)
  const originalSize = bitmapSize(bitmap)
  if (!originalSize.width || !originalSize.height) {
    throw new Error("画像サイズを取得できませんでした")
  }

  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("画像を圧縮できませんでした")
  }

  const initialScale = Math.min(1, maxDimension / Math.max(originalSize.width, originalSize.height))
  const qualities = [0.82, 0.72, 0.62, 0.52, 0.42, 0.34]
  let scale = initialScale
  let bestBlob: Blob | null = null

  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    canvas.width = Math.max(1, Math.round(originalSize.width * scale))
    canvas.height = Math.max(1, Math.round(originalSize.height * scale))
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality)
      if (!blob) continue
      bestBlob = blob
      if (blob.size <= maxBytes) {
        return new File([blob], compressedImageName(file.name), {
          type: "image/jpeg",
          lastModified: Date.now(),
        })
      }
    }

    scale *= 0.72
  }

  if (bestBlob && bestBlob.size <= maxBytes) {
    return new File([bestBlob], compressedImageName(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    })
  }

  throw new Error("画像を300KB以下に圧縮できませんでした。小さい画像を選んでください")
}
