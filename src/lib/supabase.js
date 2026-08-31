import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local for local dev, and set them as ' +
    'repository secrets for the deploy workflow.'
  )
}

// flowType: 'pkce' matters here. The default implicit flow returns
// tokens in the URL hash, which collides with hash-based routing the
// moment we add it. PKCE returns them as query params instead.
export const supabase = createClient(url, anon, {
  auth: {
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

// The narrate edge function, called once per turn.
export async function narrate({ prompt, command }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${url}/functions/v1/narrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ prompt, command }),
  })

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}))
    throw new Error(error || `Narrator failed (${res.status})`)
  }
  return res.json()   // { reply, effects }
}
