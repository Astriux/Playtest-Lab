import { getAuthToken } from 'deepspace'

/**
 * Call a server action from the browser. Resolves with the action's `data`,
 * or throws an Error whose message is safe to show the user.
 */
export async function callAction<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: string }
    | null
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body.data as T
}
