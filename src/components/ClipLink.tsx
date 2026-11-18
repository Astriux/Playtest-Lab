import { Play } from 'lucide-react'

/**
 * A tester's gameplay clip, shown as "Clip on medal.tv". The site name is
 * always visible so devs can see where a link goes before opening it.
 * The server only stores https links; this checks again before rendering.
 */
export function ClipLink({ url }: { url?: string }) {
  if (!url) return null
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    host = parsed.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 font-mono text-xs hover:border-foreground"
    >
      <Play className="h-3 w-3" aria-hidden />
      Clip on {host}
    </a>
  )
}
