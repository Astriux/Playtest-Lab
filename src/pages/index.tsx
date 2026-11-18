/**
 * Landing page. Static: no auth call, no realtime connection, prerendered to
 * HTML at build time. Keep it free of data hooks and browser-only APIs.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { Logo } from '../components/Logo'
import { seo } from '../seo'

type Row = {
  name: string
  tag: 'bug' | 'balance' | 'confusing' | 'fun'
  before: number
  after: number
}

const DEMO_ROWS: Row[] = [
  { name: 'Wave 7 is too hard', tag: 'balance', before: 7, after: 1 },
  { name: 'Crash when selling a tower', tag: 'bug', before: 3, after: 0 },
  { name: "Can't tell where towers can go", tag: 'confusing', before: 4, after: 5 },
  { name: 'Boss music goes hard', tag: 'fun', before: 0, after: 3 },
]

const TAG_COLOR: Record<Row['tag'], string> = {
  bug: 'bg-tag-bug',
  balance: 'bg-tag-balance',
  confusing: 'bg-tag-confusing',
  fun: 'bg-tag-fun',
}

function verdict(row: Row) {
  if (row.before === 0) return { label: 'new', className: 'text-tag-confusing' }
  if (row.after === 0) return { label: 'gone', className: 'text-tag-fun' }
  if (row.after < row.before) return { label: `▼ ${row.before - row.after}`, className: 'text-tag-fun' }
  return { label: `▲ ${row.after - row.before}`, className: 'text-tag-bug' }
}

const STEPS = [
  {
    title: 'Open a session on a build',
    body: 'Pick the build you are testing, open a session, and share the invite link with your testers.',
  },
  {
    title: 'Testers tag notes while they play',
    body: 'Bug, balance, confusing, or fun. One line of text and an optional screenshot. Notes show up for you live.',
  },
  {
    title: 'Compare against the last build',
    body: 'AI groups the notes into themes and keeps the same names across builds, so you can see what went down, what went up, and what is new.',
  },
]

export default function Landing() {
  const max = Math.max(...DEMO_ROWS.flatMap((r) => [r.before, r.after]))

  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Logo />
          <Link to="/home" className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </header>

        <main className="mx-auto max-w-6xl px-5 sm:px-8">
          <section className="grid items-center gap-12 border-b border-border pb-16 pt-10 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Playtest feedback, build over build
              </p>
              <h1 className="mt-5 font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-7xl">
                Did your fix <span className="text-signal">actually</span> work?
              </h1>
              <p className="mt-6 max-w-lg text-base text-muted-foreground sm:text-lg">
                Run a playtest on every build. Testers leave quick tagged notes while they play.
                Playtest Lab groups them into themes and lines them up against your last build.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to="/home"
                  className="inline-flex items-center rounded bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Start a project
                </Link>
                <span className="font-mono text-xs text-muted-foreground">Testers join with a link</span>
              </div>
            </div>

            <figure
              aria-label="Example comparison between two builds"
              className="rounded border border-border bg-card shadow-[0_1px_0_0_rgba(28,27,24,0.06)]"
            >
              <div className="flex items-baseline justify-between border-b border-border px-5 py-3">
                <span className="font-display text-sm font-bold">Tower Defense</span>
                <span className="font-mono text-xs text-muted-foreground">
                  v0.4 <span aria-hidden>→</span> v0.5
                </span>
              </div>
              <ul className="divide-y divide-border">
                {DEMO_ROWS.map((row) => {
                  const v = verdict(row)
                  return (
                    <li key={row.name} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${TAG_COLOR[row.tag]}`} aria-hidden />
                        <span className="truncate text-sm font-medium">{row.name}</span>
                      </div>
                      <span className={`font-mono text-xs font-medium uppercase ${v.className}`}>{v.label}</span>
                      <div className="col-span-2 grid grid-cols-[2.5rem_1fr] items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                        <span>v0.4</span>
                        <span className="h-1.5 rounded-sm bg-muted">
                          <span
                            className="block h-full rounded-sm bg-foreground/30"
                            style={{ width: `${(row.before / max) * 100}%` }}
                          />
                        </span>
                        <span>v0.5</span>
                        <span className="h-1.5 rounded-sm bg-muted">
                          <span
                            className={`block h-full rounded-sm ${TAG_COLOR[row.tag]}`}
                            style={{ width: `${(row.after / max) * 100}%` }}
                          />
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </figure>
          </section>

          <section className="py-16">
            <h2 className="font-display text-2xl font-bold">How a playtest runs</h2>
            <ol className="mt-8 grid gap-8 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="border-t-2 border-foreground pt-4">
                  <span className="font-mono text-xs text-signal">0{i + 1}</span>
                  <h3 className="mt-2 font-display text-lg font-bold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </main>

        <footer className="mx-auto max-w-6xl border-t border-border px-5 py-6 font-mono text-xs text-muted-foreground sm:px-8">
          Playtest Lab · built on DeepSpace
        </footer>
      </div>
    </>
  )
}
