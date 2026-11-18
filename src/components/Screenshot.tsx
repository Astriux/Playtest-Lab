import { useState } from 'react'
import { Modal } from './ui'
import { useScreenshotUrl } from '../lib/screenshot'

/** Small preview of a note's screenshot; click to see it full size. */
export function ScreenshotThumb({ feedbackId }: { feedbackId: string }) {
  const url = useScreenshotUrl(feedbackId)
  const [open, setOpen] = useState(false)

  if (!url) return <div className="h-20 w-32 animate-pulse rounded border border-border bg-muted" aria-hidden />

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded border border-border hover:border-foreground"
        aria-label="View screenshot"
      >
        <img src={url} alt="" className="h-20 w-32 object-cover" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} size="xl" aria-label="Screenshot">
        <img src={url} alt="Screenshot attached to this note" className="max-h-[75vh] w-full object-contain" />
      </Modal>
    </>
  )
}
