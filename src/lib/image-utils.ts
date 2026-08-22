const MAX_SIDE = 1024

export async function resizeImage(file: File): Promise<{ bitmap: ImageBitmap; url: string; blob: Blob }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  const resized = await createImageBitmap(blob)
  const url = URL.createObjectURL(blob)
  return { bitmap: resized, url, blob }
}

export function hashBitmap(bitmap: ImageBitmap): number {
  const canvas = new OffscreenCanvas(8, 8)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, 8, 8)
  const data = ctx.getImageData(0, 0, 8, 8).data
  let h = 0
  for (let i = 0; i < data.length; i += 4) {
    h = ((h << 5) - h + data[i]) | 0
  }
  return Math.abs(h)
}
