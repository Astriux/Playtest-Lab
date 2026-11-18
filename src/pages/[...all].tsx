import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
      <title>Not found · Playtest Lab</title>
      <meta name="robots" content="noindex" />
      <Logo />
      <p className="mt-10 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Error 404</p>
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">This page isn't in the build</h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        The link may be old, or the page was moved.
      </p>
      <Link
        to="/home"
        className="mt-6 rounded bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Go to your projects
      </Link>
    </div>
  )
}
