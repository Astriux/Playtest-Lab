/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/** A tester's display name; the demo's made-up testers become "Demo tester N". */
export function testerLabel(name: string | null, testerId: string): string {
  if (name) return name
  const demo = testerId.match(/^demo-tester-(\d+)$/)
  return demo ? `Demo tester ${demo[1]}` : 'Tester'
}

export function inviteUrl(inviteCode: string): string {
  return `${window.location.origin}/join/${inviteCode}`
}
