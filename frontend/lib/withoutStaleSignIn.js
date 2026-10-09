// A public page (the owner's claim link) must work whoever is signed in on
// this browser. A stored sign-in that has expired makes the server answer 401
// even there; apiClient clears that stored session on the 401, so asking once
// more goes without it. A 401 is refused before the view runs, so the retry
// can't repeat a change. Never use this for a request that must carry the
// signed-in session (the scout's hand-over is bound to it).
export async function withoutStaleSignIn(call) {
  try {
    return await call()
  } catch (error) {
    if (error?.status === 401) return call()
    throw error
  }
}
