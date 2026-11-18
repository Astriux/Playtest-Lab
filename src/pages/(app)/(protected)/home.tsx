/**
 * /home: the dev's project list. Step 1 shows the signed-in state only;
 * creating projects arrives with the createProject server action.
 */

import { useUser } from 'deepspace'

export default function HomePage() {
  const { user } = useUser()
  const firstName = user?.name?.split(' ')[0]

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {firstName ? `Signed in as ${firstName}` : 'Signed in'}
      </p>
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">Projects</h1>

      <div className="mt-8 rounded border border-dashed border-input bg-card px-6 py-12 text-center">
        <p className="font-display text-lg font-bold">No projects yet</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          A project holds your builds and playtest sessions. Creating one comes next.
        </p>
      </div>
    </div>
  )
}
