import React, { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import {
  applyDefaultTheme,
  checkBadge,
  loadCharacters,
  loadMe,
  loadSaves,
  loadWorlds,
  signOut,
  writeSave,
} from "./lib/db";
import { AdminPage } from "./catalog/AdminPage";
import { Browse } from "./catalog/Browse";
import { Create } from "./catalog/Create";
import { CreatorPage } from "./catalog/CreatorPage";
import { CreatorProfile } from "./catalog/CreatorProfile";
import { EditGame } from "./catalog/EditGame";
import { Friends, seedFriends } from "./catalog/Friends";
import { GameDetail } from "./catalog/GameDetail";
import { Mine } from "./catalog/Mine";
import { Profile } from "./catalog/Profile";
import { Auth, Shell, Splash1, TopBar } from "./catalog/Shell";
import { UsernamePage } from "./catalog/UsernamePage";
import { PlayLoader } from "./play/Play";
import { T, P } from "./theme";
import { Btn } from "./ui/primitives";

export default function Ascentery() {
  /* T and P are mutated in place by applyDefaultTheme, not replaced — every
     component reads T.bone/P.ink as a plain property access at render
     time, so nothing needs to re-import them. This gate just makes sure
     that mutation has already happened before the first real render, on
     every screen including Auth, rather than flashing the built-in colours
     first and jumping to a theme a moment later. */
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    applyDefaultTheme(T, P).finally(() => { if (!cancelled) setThemeReady(true); });
    return () => { cancelled = true; };
  }, []);

  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState({ name: "browse" });
  const [games, setGames] = useState([]);
  const [me, setMe] = useState(null);
  const [friends, setFriends] = useState(seedFriends);
  const [chars, setChars] = useState([]);

  const [saves, setSaves] = useState({}); // `${worldId}:${charId}` -> { state, log }

  const go = (name, params = {}) => setView({ name, ...params });
  const refreshWorlds = async () => {
    if (!session) return;
    try { setGames(await loadWorlds(session.user.id)); } catch (e) { console.error(e); }
  };

  // One listener handles first load, sign-in, sign-out and token refresh.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setMe(null); setChars([]); setSaves({}); setBooting(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* Stripe sends the customer back with ?paid=1. The balance is changed by
     the webhook, not by this redirect, so all we do here is re-read it and
     tidy the URL. There can be a second or two of lag. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("paid")) return;
    const paid = params.get("paid") === "1";
    window.history.replaceState({}, "", window.location.pathname);
    if (!paid || !session) return;
    const t = setTimeout(() => {
      loadMe(session.user.id)
        .then((m) => {
          setMe(m);
          // A first purchase with no username yet: the next thing they need.
          if (!m.username) setView({ name: "username", next: "mine" });
        })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [session]);

  // Pull everything that belongs to this user once we have a session.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const uid = session.user.id;
        const [m, cs, sv, ws] = await Promise.all([
          loadMe(uid), loadCharacters(uid), loadSaves(uid), loadWorlds(uid),
        ]);
        if (cancelled) return;
        setMe(m); setChars(cs); setSaves(sv); setGames(ws); setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  if (!themeReady) return null;
  if (booting) return <Shell><Splash1 /></Shell>;
  if (!session) return <Shell><Auth /></Shell>;
  if (loadError) return (
    <Shell>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontFamily: T.serif, fontSize: 22, marginBottom: 8 }}>Couldn't load your account</div>
          <p style={{ fontFamily: T.mono, fontSize: 12, color: T.clay, lineHeight: 1.7 }}>{loadError}</p>
          <Btn onClick={() => signOut()} style={{ marginTop: 14 }}>Sign out</Btn>
        </div>
      </div>
    </Shell>
  );
  if (!me) return <Shell><Splash1 /></Shell>;

  if (view.name === "play") {
    const key = `${view.id}:${view.charId}`;
    return (
      <PlayLoader
        worldId={view.id}
        char={chars.find((c) => c.id === view.charId)}
        save={saves[key]}
        onSave={(v) => {
          setSaves((s) => ({ ...s, [key]: v }));
          writeSave({ userId: me.id, worldId: view.id, characterId: view.charId, ...v })
            .then(() => checkBadge(view.id))
            .catch((e) => console.error("save failed", e));
        }}
        onExit={() => go("game", { id: view.id })}
        onHome={() => go("mine")}
      />
    );
  }

  return (
    <Shell>
      <TopBar me={me} view={view} go={go} />
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 22px 80px" }}>
        {view.name === "browse" && <Browse games={games.filter((g) => g.published)} go={go} />}
        {view.name === "mine" && <Mine games={games.filter((g) => g.authorId === me.id)} go={go} />}
        {view.name === "friends" && <Friends friends={friends} setFriends={setFriends} games={games} go={go} />}
        {view.name === "profile" && <Profile me={me} setMe={setMe} chars={chars} setChars={setChars} go={go} />}
        {view.name === "creator" && <CreatorPage me={me} go={go} />}
        {view.name === "admin" && <AdminPage me={me} go={go} />}
        {view.name === "username" && <UsernamePage me={me} setMe={setMe} go={go} reason={view.reason} next={view.next} />}
        {view.name === "create" && <Create me={me} refreshWorlds={refreshWorlds} go={go} />}
        {view.name === "game" && <GameDetail game={games.find((g) => g.id === view.id)} chars={chars} saves={saves} setSaves={setSaves} userId={me.id} go={go} from={view.from ?? "browse"} isMine={games.find((g) => g.id === view.id)?.authorId === me.id} />}

        {view.name === "creatorProfile" && <CreatorProfile username={view.username} go={go} />}
        {view.name === "edit" && <EditGame game={games.find((g) => g.id === view.id)} refreshWorlds={refreshWorlds} me={me} setMe={setMe} go={go} chars={chars} />}
      </main>
    </Shell>
  );
}
