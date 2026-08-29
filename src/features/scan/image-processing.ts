const MAX_SIDE = 1024
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

type ResizeCanvas = OffscreenCanvas | HTMLCanvasElement

function createCanvas(width: number, height: number): ResizeCanvas {
  if ('OffscreenCanvas' in globalThis) return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function canvasToJpeg(canvas: ResizeCanvas): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  }
  const htmlCanvas = canvas as HTMLCanvasElement
  return new Promise((resolve, reject) => {
    htmlCanvas.toBlob(
      (blob: Blob | null) => blob
        ? resolve(blob)
        : reject(new Error('The resized photo could not be encoded.')),
      'image/jpeg',
      0.85,
    )
  })
}

export async function resizeImage(file: Blob): Promise<{ bitmap: ImageBitmap; url: string; blob: Blob }> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Photo is too large. Choose an image smaller than 25 MB.')
  }
  const bitmap = await createImageBitmap(file)
  let blob: Blob
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Photo has invalid dimensions.')
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('A 2D canvas is required to resize the photo.')
    context.drawImage(bitmap, 0, 0, width, height)
    blob = await canvasToJpeg(canvas)
  } finally {
    bitmap.close()
  }
  const resized = await createImageBitmap(blob)
  const url = URL.createObjectURL(blob)
  return { bitmap: resized, url, blob }
}

export function hashBitmap(bitmap: ImageBitmap): number {
  const canvas = createCanvas(8, 8)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('A 2D canvas is required to inspect the photo.')
  context.drawImage(bitmap, 0, 0, 8, 8)
  const data = context.getImageData(0, 0, 8, 8).data
  let h = 0
  for (let i = 0; i < data.length; i += 4) {
    h = ((h << 5) - h + data[i]) | 0
  }
  return Math.abs(h)
}
