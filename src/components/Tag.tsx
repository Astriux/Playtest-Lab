import { cn } from '../lib/utils'
import type { Tag } from '../schemas/playtest-schemas'

/** One look per tag, used everywhere a tag appears. */
export const TAG_META: Record<Tag, { label: string; dot: string; text: string; soft: string }> = {
  bug: { label: 'Bug', dot: 'bg-tag-bug', text: 'text-tag-bug', soft: 'bg-tag-bug/10 border-tag-bug/40' },
  balance: {
    label: 'Balance',
    dot: 'bg-tag-balance',
    text: 'text-tag-balance',
    soft: 'bg-tag-balance/10 border-tag-balance/40',
  },
  confusing: {
    label: 'Confusing',
    dot: 'bg-tag-confusing',
    text: 'text-tag-confusing',
    soft: 'bg-tag-confusing/10 border-tag-confusing/40',
  },
  fun: { label: 'Fun', dot: 'bg-tag-fun', text: 'text-tag-fun', soft: 'bg-tag-fun/10 border-tag-fun/40' },
}

export function TagChip({ tag, className }: { tag: Tag; className?: string }) {
  const meta = TAG_META[tag]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase',
        meta.soft,
        meta.text,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  )
}
