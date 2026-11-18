/**
 * Every page under (protected)/ requires sign-in. The folder name is not
 * magic: this layout's <AuthGate> is what does the gating.
 *
 * Signing in with Google/GitHub always comes back to /home. So before the
 * sign-in starts we remember where the user was (e.g. an invite link), and
 * send them back there once they're signed in.
 */

import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Button } from '@/components/ui'

const RETURN_KEY = 'playtest-lab:return-to'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <ReturnAfterSignIn />
      <Outlet />
    </AuthGate>
  )
}

function ReturnAfterSignIn() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    let target: string | null = null
    try {
      target = sessionStorage.getItem(RETURN_KEY)
      sessionStorage.removeItem(RETURN_KEY)
    } catch {
      return
    }
    // Only same-site paths: "/join/abc" yes, "//evil.com" or "https://..." no.
    if (target && target.startsWith('/') && !target.startsWith('//') && target !== location.pathname) {
      navigate(target, { replace: true })
    }
  }, [navigate, location.pathname])

  return null
}

function SignedOutPanel() {
  const [showAuthModal, setShowAuthModal] = useState(false)
  const location = useLocation()
  const isInvite = location.pathname.startsWith('/join/')

  function startSignIn() {
    try {
      sessionStorage.setItem(RETURN_KEY, location.pathname)
    } catch {
      // Private mode: they'll land on /home and can reopen the link.
    }
    setShowAuthModal(true)
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm rounded border border-border bg-card p-8 text-center">
        <h1 className="font-display text-xl font-bold text-foreground">
          {isInvite ? "You're invited to a playtest" : 'Sign in to continue'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isInvite
            ? 'Sign in so the developers know which notes are yours. Only they and you can see your notes.'
            : 'Devs and testers both sign in, so every note is tied to a real person.'}
        </p>
        <Button className="mt-6 w-full" onClick={startSignIn}>
          Sign in
        </Button>
        <Link
          to="/"
          className="mt-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to home
        </Link>
      </div>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}
