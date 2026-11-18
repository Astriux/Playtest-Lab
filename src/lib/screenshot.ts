import { useEffect, useState } from 'react'
import { getAuthToken } from 'deepspace'

const MAX_SIDE = 1600

/**
 * Shrink an image to at most 1600px on its longest side and re-encode it as
 * JPEG. Keeps uploads small (a 4K PNG becomes a few hundred KB) and drops
 * hidden metadata like GPS location, since we redraw only the pixels.
 */
export async function prepareScreenshot(file: Blob): Promise<{ base64: string; previewUrl: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image.'))), 'image/jpeg', 0.85),
  )
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(blob)
  })
  return { base64: dataUrl.split(',')[1], previewUrl: URL.createObjectURL(blob) }
}

/**
 * Load a note's screenshot through the protected route. A plain <img src>
 * can't send the sign-in token, so we fetch it and hand <img> a local URL.
 */
export function useScreenshotUrl(feedbackId: string): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void (async () => {
      const token = await getAuthToken()
      const res = await fetch(`/api/screenshots/${feedbackId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok || cancelled) return
      objectUrl = URL.createObjectURL(await res.blob())
      if (cancelled) URL.revokeObjectURL(objectUrl)
      else setUrl(objectUrl)
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [feedbackId])

  return url
}
