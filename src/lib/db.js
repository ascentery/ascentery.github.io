import { supabase } from './supabase'

/* Every database read and write lives here, so components never
   build queries inline. If a table shape changes, this is the only
   file that has to know. */

/* ---------- profile, credits ---------- */

export async function loadMe(userId) {
  const [{ data: profile, error: pe }, { data: credits }] = await Promise.all([
    supabase.from('profiles').select('id, display_name, gamer_tag').eq('id', userId).single(),
    supabase.from('credits').select('balance, cap').eq('user_id', userId).single(),
  ])

  // A missing profile means the handle_new_user trigger didn't fire.
  if (pe) throw new Error('No profile found for this account. Check the on_auth_user_created trigger.')

  return {
    id: profile.id,
    name: profile.display_name,
    tag: profile.gamer_tag,
    credits: credits?.balance ?? 0,
    creditCap: credits?.cap ?? 500,
  }
}

export async function saveDisplayName(userId, name) {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: name })
    .eq('id', userId)
  if (error) throw error
}

/* ---------- characters ---------- */

export async function loadCharacters(userId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, bio')
    .eq('user_id', userId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function createCharacter(userId, name) {
  const { data, error } = await supabase
    .from('characters')
    .insert({ user_id: userId, name })
    .select('id, name, bio')
    .single()
  if (error) throw error
  return data
}

export async function updateCharacterBio(id, bio) {
  const { error } = await supabase.from('characters').update({ bio }).eq('id', id)
  if (error) throw error
}

export async function deleteCharacter(id) {
  const { error } = await supabase.from('characters').delete().eq('id', id)
  if (error) throw error
}

/* ---------- saves ----------
   Keyed on (world_id, character_id), matching the unique constraint,
   so one account can hold separate progress per character. */

export async function loadSaves(userId) {
  const { data, error } = await supabase
    .from('saves')
    .select('world_id, character_id, state, log')
    .eq('user_id', userId)
  if (error) throw error

  const map = {}
  for (const row of data ?? []) {
    map[`${row.world_id}:${row.character_id}`] = { state: row.state, log: row.log }
  }
  return map
}

export async function writeSave({ userId, worldId, characterId, state, log }) {
  const { error } = await supabase.from('saves').upsert(
    {
      user_id: userId,
      world_id: worldId,
      character_id: characterId,
      state,
      log: log.slice(-120),        // keep the tail; full transcripts get large
      turn: state.turn ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'world_id,character_id' },
  )
  if (error) throw error
}

/* ---------- auth ---------- */

export async function signUp({ email, password, displayName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || 'New player' } },
  })
  if (error) throw error
  // With email confirmation on, session is null until they click the link.
  return { needsConfirmation: !data.session }
}

export async function signIn({ email, password }) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut() {
  await supabase.auth.signOut()
}

/* ---------- worlds ---------- */

/** Catalog rows only. Never pulls world_data — that would drag every
    blob across the wire just to render a grid of cards. */
export async function loadWorlds(userId) {
  const { data, error } = await supabase
    .from('worlds')
    .select('id, owner_id, title, blurb, status, published, plays, room_count, mob_count, cover_path, failure_note, created_at')
    .or(`published.eq.true,owner_id.eq.${userId}`)
    .order('created_at', { ascending: false })
  if (error) throw error

  const ownerIds = [...new Set((data ?? []).map((w) => w.owner_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, gamer_tag')
    .in('id', ownerIds.length ? ownerIds : ['00000000-0000-0000-0000-000000000000'])

  const byId = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))

  return (data ?? []).map((w) => ({
    id: w.id,
    title: w.title,
    blurb: w.blurb ?? '',
    status: w.status,
    published: w.published,
    plays: w.plays ?? 0,
    rooms: w.room_count ?? 0,
    mobs: w.mob_count ?? 0,
    failureNote: w.failure_note,
    coverPath: w.cover_path,
    authorId: w.owner_id,
    author: byId[w.owner_id]?.display_name ?? 'Someone',
    tag: byId[w.owner_id]?.gamer_tag ?? '',
    playable: w.status === 'ready',
  }))
}

export async function loadWorldData(worldId) {
  const { data, error } = await supabase
    .from('world_data')
    .select('data, warnings')
    .eq('world_id', worldId)
    .single()
  if (error) throw new Error('That world has no data yet.')
  return data
}

export async function createWorld({ userId, title, brief }) {
  const { data, error } = await supabase
    .from('worlds')
    .insert({ owner_id: userId, title, brief, status: 'generating' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/** Fire the generate function. Takes 30–90 seconds. */
export async function generateWorld(worldId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ worldId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Generation failed (${res.status})`)
  return body    // { status, stats, warnings, title, blurb }
}

export async function setPublished(worldId, published) {
  const { error } = await supabase.from('worlds').update({ published }).eq('id', worldId)
  if (error) throw error
}

export async function deleteWorld(worldId) {
  const { error } = await supabase.from('worlds').delete().eq('id', worldId)
  if (error) throw error
}

export async function bumpPlays(worldId) {
  await supabase.rpc('bump_plays', { p_world: worldId }).catch(() => {})
}

/* ---------- room art rows ---------- */

const PUBLIC_ROOMS = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/rooms/`

export const roomImageUrl = (path) => (path ? PUBLIC_ROOMS + path : null)

export async function loadRooms(worldId) {
  const { data, error } = await supabase
    .from('world_rooms')
    .select('id, room_key, name, image_path, image_prompt, locked, sort')
    .eq('world_id', worldId)
    .order('sort')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id,
    key: r.room_key,
    name: r.name,
    prompt: r.image_prompt ?? '',
    url: roomImageUrl(r.image_path),
    art: Boolean(r.image_path),
    locked: r.locked,
  }))
}

/** Draws one room. Takes 20-60 seconds and costs credits.
    Returns { url, credits } so the caller can update both at once. */
export async function drawRoom(roomId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roomart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ roomId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Drawing failed (${res.status})`)
  return body
}

export async function setRoomLock(roomId, locked) {
  const { error } = await supabase.from('world_rooms').update({ locked }).eq('id', roomId)
  if (error) throw error
}

/* ---------- images ---------- */

const SB = import.meta.env.VITE_SUPABASE_URL

/** Storage buckets are public, so a path is enough to build a URL. */
export function imageUrl(bucket, path) {
  return path ? `${SB}/storage/v1/object/public/${bucket}/${path}` : null
}

/** Draw a room (roomKey given) or the world's cover (roomKey omitted).
    Costs credits; the function refunds them if the draw fails. */
export async function illustrate({ worldId, roomKey = null }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(`${SB}/functions/v1/illustrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ worldId, roomKey }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Illustration failed (${res.status})`)
  return body    // { path, bucket, balance, cost }
}
