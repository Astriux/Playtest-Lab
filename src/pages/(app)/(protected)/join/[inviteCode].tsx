/**
 * /join/:inviteCode: the tester's page. Testers aren't on the team, so they
 * can't read the session or project. joinSession (a server action) hands
 * back just what this page needs to show.
 */

import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { ImagePlus, X } from 'lucide-react'
import { Button, Textarea } from '@/components/ui'
import { ScreenshotThumb } from '../../../../components/Screenshot'
import { TAG_META, TagChip } from '../../../../components/Tag'
import { callAction } from '../../../../lib/actions'
import { timeAgo } from '../../../../lib/format'
import { prepareScreenshot } from '../../../../lib/screenshot'
import { cn } from '../../../../lib/utils'
import { TAGS, type FeedbackData, type Tag } from '../../../../schemas/playtest-schemas'

type SessionInfo = {
  sessionId: string
  status: 'open' | 'closed'
  projectName: string
  version: string
  changelog: string
}

export default function JoinPage() {
  const { inviteCode = '' } = useParams()
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    callAction<SessionInfo>('joinSession', { inviteCode }).then(setInfo, (err: Error) => setLoadError(err.message))
  }, [inviteCode])

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <h1 className="font-display text-2xl font-bold">Can't open this playtest</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError} Ask the developer for a new link.</p>
      </div>
    )
  }
  if (!info) return <p className="mx-auto max-w-xl px-5 py-16 text-sm text-muted-foreground">Opening playtest…</p>

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Playtesting {info.projectName}
      </p>
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">
        Build <span className="font-mono text-3xl font-medium">{info.version}</span>
      </h1>
      {info.changelog && (
        <div className="mt-4 border-l-2 border-signal pl-4">
          <p className="font-mono text-xs uppercase text-muted-foreground">What changed</p>
          <p className="mt-1 whitespace-pre-line text-sm">{info.changelog}</p>
        </div>
      )}

      {info.status === 'open' ? (
        <NoteForm inviteCode={inviteCode} />
      ) : (
        <p className="mt-8 rounded border border-border bg-card px-5 py-6 text-sm">
          This session has ended. Thanks for playing!
        </p>
      )}

      <MyNotes sessionId={info.sessionId} />
    </div>
  )
}

type Shot = { base64: string; previewUrl: string }

function NoteForm({ inviteCode }: { inviteCode: string }) {
  const [tag, setTag] = useState<Tag | null>(null)
  const [text, setText] = useState('')
  const [shot, setShot] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  // Inline status instead of toasts: on a phone a toast covers the Send button.
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function clearShot() {
    if (shot) URL.revokeObjectURL(shot.previewUrl)
    setShot(null)
  }

  async function attach(file: Blob | null | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    try {
      clearShot()
      setShot(await prepareScreenshot(file))
    } catch (err) {
      setStatus({ ok: false, message: (err as Error).message })
    }
  }

  function onPaste(e: ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    void attach(item.getAsFile())
  }

  async function send(e?: FormEvent) {
    e?.preventDefault()
    if (busy) return
    if (!tag) return setStatus({ ok: false, message: 'Pick a tag first.' })
    if (!text.trim()) return setStatus({ ok: false, message: 'Write what happened.' })
    setBusy(true)
    setStatus(null)
    try {
      await callAction('submitFeedback', { inviteCode, tag, text, screenshot: shot?.base64 })
      setStatus({ ok: true, message: 'Sent. Keep them coming.' })
      setText('')
      clearShot()
    } catch (err) {
      setStatus({ ok: false, message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={send} onPaste={onPaste} className="mt-8 rounded border border-border bg-card p-5">
      <fieldset>
        <legend className="text-sm font-medium">What kind of note?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TAGS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => setTag(t)}
              className={cn(
                'flex items-center justify-center gap-2 rounded border px-3 py-2.5 text-sm font-medium transition-colors',
                tag === t ? cn(TAG_META[t].soft, TAG_META[t].text, 'border-current') : 'border-input hover:border-foreground',
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', TAG_META[t].dot)} aria-hidden />
              {TAG_META[t].label}
            </button>
          ))}
        </div>
      </fieldset>

      <label htmlFor="note-text" className="mt-4 block text-sm font-medium">
        What happened?
      </label>
      <Textarea
        id="note-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send()
        }}
        placeholder="Wave 7 wiped me out three times in a row"
        maxLength={1000}
        rows={3}
        className="mt-1"
      />

      <div className="mt-3 flex items-center gap-3">
        {shot ? (
          <div className="relative">
            <img src={shot.previewUrl} alt="Screenshot to attach" className="h-16 w-28 rounded border border-border object-cover" />
            <button
              type="button"
              onClick={clearShot}
              aria-label="Remove screenshot"
              className="absolute -right-2 -top-2 rounded-full border border-border bg-card p-0.5 hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <ImagePlus aria-hidden />
            Add screenshot
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{shot ? 'Will be sent with this note' : 'or paste one with Ctrl+V'}</span>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          aria-label="Screenshot file"
          onChange={(e) => {
            void attach(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <span
          role="status"
          className={cn('font-mono text-xs', status ? (status.ok ? 'text-tag-fun' : 'text-destructive') : 'text-muted-foreground')}
        >
          {status?.message ?? 'Ctrl + Enter to send'}
        </span>
        <Button type="submit" loading={busy}>
          Send note
        </Button>
      </div>
    </form>
  )
}

/** The server only sends this tester's own notes; the filter is just tidy-up for devs testing their own link. */
function MyNotes({ sessionId }: { sessionId: string }) {
  const { userId } = useAuth()
  const { records } = useQuery<FeedbackData>('feedback', {
    where: { sessionId },
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const mine = records.filter((r) => r.data.testerId === userId)
  if (mine.length === 0) return null

  return (
    <section className="mt-10">
      <h2 className="border-b-2 border-foreground pb-2 font-display text-lg font-bold">Your notes ({mine.length})</h2>
      <ul className="divide-y divide-border">
        {mine.map((n) => (
          <li key={n.recordId} className="flex items-start gap-3 py-3">
            <TagChip tag={n.data.tag} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{n.data.text}</p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{timeAgo(n.createdAt)}</p>
              {n.data.screenshotKey && (
                <div className="mt-2">
                  <ScreenshotThumb feedbackId={n.recordId} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
