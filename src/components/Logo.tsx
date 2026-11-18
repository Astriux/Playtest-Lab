import { Link } from 'react-router-dom'

/** Brand mark: two report bars, one tall (before) and one short (after). */
export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
        <rect width="32" height="32" rx="6" fill="var(--color-signal)" />
        <rect x="8" y="9" width="6" height="15" rx="1" fill="var(--color-foreground)" />
        <rect x="18" y="17" width="6" height="7" rx="1" fill="var(--color-primary-foreground)" />
      </svg>
      <span className="font-display text-base font-extrabold tracking-tight">Playtest Lab</span>
    </Link>
  )
}
