import React, { useState, useEffect } from "react";
import {
  followCreator,
  loadCompletedGames,
  loadCreatorGames,
  loadCreatorProfile,
  loadFollowStatus,
  loadFollowing,
  unfollowCreator,
} from "../lib/db";
import { T, grid } from "../theme";
import { Avatar, Btn, Empty, H1 } from "../ui/primitives";

export function CreatorProfile({ username, me, go }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null);           // set once the profile loads
  const [games, setGames] = useState(null);
  const [completed, setCompleted] = useState(null);

  const isOwnProfile = me?.username === username;
  const [follow, setFollow] = useState(null);     // { isFollowing, followerCount }
  const [followBusy, setFollowBusy] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [following, setFollowing] = useState(null);

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

  const openFollowing = () => {
    setShowFollowing((v) => !v);
    if (following === null) {
      loadFollowing(profile.id).then(setFollowing).catch(() => setFollowing([]));
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadCreatorProfile(username)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        // A non-creator has no "their games" tab at all, so Completed is
        // the only sensible thing to open on.
        setTab(p.isCreator ? "games" : "completed");
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    if (!profile) return;
    if (profile.isCreator && games === null) {
      loadCreatorGames(profile.id).then(setGames).catch(() => setGames([]));
    }
    if (completed === null) {
      loadCompletedGames(profile.id).then(setCompleted).catch(() => setCompleted([]));
    }
    if (follow === null) {
      loadFollowStatus(profile.id).then(setFollow).catch(() => setFollow({ isFollowing: false, followerCount: 0 }));
    }
  }, [profile, games, completed, follow]);

  if (error) return <Empty title="That creator could not be found." line={error} />;
  if (!profile) return <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>;

  const tabs = [
    ...(profile.isCreator ? [["games", "Games"]] : []),
    ["completed", "Completed"],
    ["badges", "Badges"],
  ];

  return (
    <div className="pf-in">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <Avatar name={profile.name} tag={profile.username} size={62}
          src={profile.avatarMode === "generated" ? profile.avatarUrl : undefined}
          bgColor={profile.avatarMode === "default" ? profile.avatarBgColor : undefined}
          letterColor={profile.avatarMode === "default" ? profile.avatarLetterColor : undefined} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.serif, fontSize: 22 }}>{profile.name}</div>
          <div style={{ fontFamily: T.mono, fontSize: 13, color: T.ochre }}>@{profile.username}</div>
        </div>

        {/* "Following" always means the viewer's own following list,
            regardless of whose profile this is — it does not change
            based on isOwnProfile. Only the button on the far right does:
            a Follow/Unfollow toggle for someone else's profile, or a
            plain Followers count on your own. */}
        <Btn kind="ghost" onClick={openFollowing}>Following</Btn>
        {isOwnProfile ? (
          <Btn kind="ghost">{follow ? `${follow.followerCount} Followers` : "Followers"}</Btn>
        ) : (
          <Btn kind={follow?.isFollowing ? "ghost" : "solid"} disabled={!follow || followBusy} onClick={toggleFollow}>
            {follow?.isFollowing ? "Following \u2713" : "Follow"}
          </Btn>
        )}
      </div>

      {showFollowing && (
        <div style={{ border: "1px solid " + T.edge, borderRadius: 2, padding: 14, marginBottom: 20 }}>
          {following === null ? (
            <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, margin: 0 }}>loading</p>
          ) : !following.length ? (
            <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim, margin: 0 }}>Not following anyone yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {following.map((f) => (
                <button key={f.id} onClick={() => f.username && go("creatorProfile", { username: f.username })}
                  className="pf-btn" disabled={!f.username}
                  style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none",
                    padding: 0, cursor: f.username ? "pointer" : "default", textAlign: "left" }}>
                  <Avatar name={f.name} tag={f.username} size={28}
                    src={f.avatarMode === "generated" ? f.avatarUrl : undefined}
                    bgColor={f.avatarMode === "default" ? f.avatarBgColor : undefined}
                    letterColor={f.avatarMode === "default" ? f.avatarLetterColor : undefined} />
                  <span style={{ fontFamily: T.mono, fontSize: 12, color: T.bone }}>{f.name}</span>
                  {f.username && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.ochre }}>@{f.username}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Gamer tag is deliberately never shown here, or fetched by
          loadCreatorProfile at all — it stays private no matter who is
          looking, including on their own public page. */}

      {profile.bio && (
        <p style={{ fontFamily: T.serif, fontSize: 15, color: T.boneDim, lineHeight: 1.6, margin: "16px 0 0" }}>
          {profile.bio}
        </p>
      )}

      <div style={{ display: "flex", gap: 4, margin: "26px 0 20px" }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="pf-btn"
            style={{ background: "transparent", cursor: "pointer", padding: "7px 12px", borderRadius: 2,
              fontFamily: T.mono, fontSize: 12, color: tab === k ? T.bone : T.boneDim,
              border: "1px solid " + (tab === k ? T.ochre : T.edge) }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "games" && (
        games === null ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
        : !games.length ? <Empty title="Nothing published yet." />
        : (
          <div style={grid}>
            {games.map((g) => (
              <button key={g.id} onClick={() => go("game", { id: g.id })} className="pf-btn"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ aspectRatio: "16/9", background: T.raised, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                  {g.coverUrl && <img src={g.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontFamily: T.serif, fontSize: 15, color: T.bone }}>{g.title}</div>
              </button>
            ))}
          </div>
        )
      )}

      {tab === "completed" && (
        completed === null ? <p style={{ fontFamily: T.mono, fontSize: 11, color: T.boneDim }}>loading</p>
        : !completed.length ? <Empty title="No completed games yet." />
        : (
          <div style={grid}>
            {completed.map((g) => (
              <button key={g.worldId} onClick={() => go("game", { id: g.worldId })} className="pf-btn"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ aspectRatio: "16/9", background: T.raised, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                  {g.coverUrl && <img src={g.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ fontFamily: T.serif, fontSize: 15, color: T.bone }}>{g.title}</div>
              </button>
            ))}
          </div>
        )
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
    </div>
  );
}
