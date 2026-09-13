import React, { useState, useEffect } from "react";
import {
  followCreator,
  loadCompletedGames,
  loadCreatorGames,
  loadCreatorProfile,
  loadCreatorProfileById,
  loadFollowers,
  loadFollowing,
  loadFollowStatus,
  loadGamesByFollowedCreators,
  unfollowCreator,
} from "../lib/db";
import { T, grid } from "../theme";
import { Avatar, Btn, Empty } from "../ui/primitives";

function PersonRow({ person, go }) {
  return (
    <button onClick={() => person.username && go("creatorProfile", { username: person.username })}
      className="pf-btn" disabled={!person.username}
      style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none",
        padding: "6px 0", cursor: person.username ? "pointer" : "default", textAlign: "left", width: "100%" }}>
      <Avatar name={person.name} tag={person.username} size={36}
        src={person.avatarMode === "generated" ? person.avatarUrl : undefined}
        bgColor={person.avatarMode === "default" ? person.avatarBgColor : undefined}
        bgColor2={person.avatarMode === "default" ? person.avatarBgColor2 : undefined}
        letterColor={person.avatarMode === "default" ? person.avatarLetterColor : undefined} />
      <div>
        <div style={{ fontFamily: T.serif, fontSize: 14, color: T.bone }}>{person.name}</div>
        {/* Username only when they have one — no placeholder text in its
            place, and never the gamer tag here or anywhere on this page. */}
        {person.username && (
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ochre }}>@{person.username}</div>
        )}
      </div>
    </button>
  );
}

function GameGrid({ games, go, emptyTitle }) {
  if (!games.length) return <Empty title={emptyTitle} />;
  return (
    <div style={grid}>
      {games.map((g) => (
        <button key={g.id} onClick={() => go("game", { id: g.id })} className="pf-btn"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
          <div style={{ aspectRatio: "16/9", background: T.raised, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
            {g.coverUrl && <img src={g.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          </div>
          <div style={{ fontFamily: T.serif, fontSize: 15, color: T.bone }}>{g.title}</div>
          {g.authorName && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, marginTop: 2 }}>
              {g.authorUsername ? `@${g.authorUsername}` : g.authorName}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

export function CreatorProfile({ username, selfId, me, go }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null);
  const [games, setGames] = useState(null);
  const [completed, setCompleted] = useState(null);
  const [followedGames, setFollowedGames] = useState(null);

  // Robust against both sides lacking a username (two different people
  // who have never claimed one would otherwise both compare as
  // undefined === undefined and incorrectly read as "this is me").
  const isOwnProfile = Boolean(profile && me && profile.id === me.id);

  // Someone else's page: just a count and a Follow toggle. Your own page:
  // both lists, fetched up front rather than lazily, since seeing them is
  // the point of visiting your own page at all.
  const [follow, setFollow] = useState(null);       // { isFollowing, followerCount } — other people's pages only
  const [followBusy, setFollowBusy] = useState(false);
  const [following, setFollowing] = useState(null); // own page only
  const [followers, setFollowers] = useState(null); // own page only
  const [listTab, setListTab] = useState("following");
  const [showLists, setShowLists] = useState(false);

  const toggleFollow = async () => {
    if (!follow || followBusy) return;
    setFollowBusy(true);
    try {
      if (follow.isFollowing) {
        await unfollowCreator(profile.id);
        setFollow((f) => ({ isFollowing: false, followerCount: f.followerCount - 1 }));
      } else {
        await followCreator(profile.id);
        setFollow((f) => ({ isFollowing: true, followerCount: f.followerCount + 1 }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setFollowBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setProfile(null); setError(null); setTab(null);
    setGames(null); setCompleted(null); setFollowedGames(null);
    setFollow(null); setFollowing(null); setFollowers(null); setShowLists(false);

    const loader = selfId ? loadCreatorProfileById(selfId) : loadCreatorProfile(username);
    loader
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setTab(p.isCreator ? "created" : "completed");
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [username, selfId]);

  useEffect(() => {
    if (!profile) return;
    if (profile.isCreator && games === null) {
      loadCreatorGames(profile.id).then(setGames).catch(() => setGames([]));
    }
    if (completed === null) {
      loadCompletedGames(profile.id).then(setCompleted).catch(() => setCompleted([]));
    }
    if (isOwnProfile) {
      if (following === null) loadFollowing(profile.id).then(setFollowing).catch(() => setFollowing([]));
      if (followers === null) loadFollowers(profile.id).then(setFollowers).catch(() => setFollowers([]));
      if (followedGames === null) loadGamesByFollowedCreators(profile.id).then(setFollowedGames).catch(() => setFollowedGames([]));
    } else if (follow === null) {
      loadFollowStatus(profile.id).then(setFollow).catch(() => setFollow({ isFollowing: false, followerCount: 0 }));
    }
  }, [profile, isOwnProfile, games, completed, following, followers, followedGames, follow]);

  if (error) return <Empty title="That profile could not be found." line={error} />;
  if (!profile) return <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>;

  const tabs = [
    ...(profile.isCreator ? [["created", "Games created"]] : []),
    ["completed", "Games completed"],
    ["badges", "Badges Collected"],
    ...(isOwnProfile ? [["followed", "Games by creators you follow"]] : []),
  ];

  return (
    <div className="pf-in">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
        <Avatar name={profile.name} tag={profile.username} size={62}
          src={profile.avatarMode === "generated" ? profile.avatarUrl : undefined}
          bgColor={profile.avatarMode === "default" ? profile.avatarBgColor : undefined}
          bgColor2={profile.avatarMode === "default" ? profile.avatarBgColor2 : undefined}
          letterColor={profile.avatarMode === "default" ? profile.avatarLetterColor : undefined} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.serif, fontSize: 22 }}>{profile.name}</div>
          {profile.username && (
            <div style={{ fontFamily: T.mono, fontSize: 13, color: T.ochre }}>@{profile.username}</div>
          )}
        </div>

        {/* Gamer tag is deliberately never fetched or shown anywhere on
            this page, own profile or otherwise. */}

        {isOwnProfile ? (
          <>
            <Btn kind="ghost" onClick={() => { setListTab("following"); setShowLists((v) => !v || listTab !== "following"); }}>
              Following {following ? `(${following.length})` : ""}
            </Btn>
            <Btn kind="ghost" onClick={() => { setListTab("followers"); setShowLists((v) => !v || listTab !== "followers"); }}>
              Followers {followers ? `(${followers.length})` : ""}
            </Btn>
          </>
        ) : (
          <>
            <Btn kind="ghost">{follow ? `${follow.followerCount} Followers` : "\u2026 Followers"}</Btn>
            <Btn kind={follow?.isFollowing ? "ghost" : "solid"} disabled={!follow || followBusy} onClick={toggleFollow}>
              {follow?.isFollowing ? "Following \u2713" : "Follow"}
            </Btn>
          </>
        )}
      </div>

      {isOwnProfile && showLists && (
        <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: 14, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {[["following", "Following"], ["followers", "Followers"]].map(([k, label]) => (
              <button key={k} onClick={() => setListTab(k)} className="pf-btn"
                style={{ background: "transparent", cursor: "pointer", padding: "5px 10px", borderRadius: 2,
                  fontFamily: T.mono, fontSize: 11.5, color: listTab === k ? T.bone : T.boneDim,
                  border: "1px solid " + (listTab === k ? T.ochre : T.edge) }}>
                {label}
              </button>
            ))}
          </div>
          {(() => {
            const list = listTab === "following" ? following : followers;
            const emptyText = listTab === "following" ? "Not following anyone yet." : "No followers yet.";
            if (list === null) return <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, margin: 0 }}>loading</p>;
            if (!list.length) return <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, margin: 0 }}>{emptyText}</p>;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {list.map((p) => <PersonRow key={p.id} person={p} go={go} />)}
              </div>
            );
          })()}
        </div>
      )}

      {profile.bio && (
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "16px 0 0" }}>
          {profile.bio}
        </p>
      )}

      <div style={{ display: "flex", gap: 4, margin: "26px 0 20px", flexWrap: "wrap" }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="pf-btn"
            style={{ background: "transparent", cursor: "pointer", padding: "7px 12px", borderRadius: 2,
              fontFamily: T.mono, fontSize: 12, color: tab === k ? T.bone : T.boneDim,
              border: "1px solid " + (tab === k ? T.ochre : T.edge) }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "created" && (
        games === null
          ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
          : <GameGrid games={games} go={go} emptyTitle="Nothing published yet." />
      )}

      {tab === "completed" && (
        completed === null
          ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
          : <GameGrid games={completed.map((g) => ({ id: g.worldId, title: g.title, coverUrl: g.coverUrl }))}
              go={go} emptyTitle="No completed games yet." />
      )}

      {tab === "badges" && (
        completed === null ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
        : !completed.filter((g) => g.badgeUrl).length ? <Empty title="No badges yet." line="Finish a game to earn one." />
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 16 }}>
            {completed.filter((g) => g.badgeUrl).map((g) => (
              <div key={g.worldId} style={{ textAlign: "center" }}>
                <div style={{ aspectRatio: "1/1", background: T.raised, borderRadius: "50%", overflow: "hidden", marginBottom: 6 }}>
                  <img src={g.badgeUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>{g.title}</div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "followed" && isOwnProfile && (
        followedGames === null
          ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
          : <GameGrid games={followedGames} go={go}
              emptyTitle="Nothing yet — follow a creator to see their new games here." />
      )}
    </div>
  );
}
