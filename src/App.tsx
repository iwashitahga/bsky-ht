import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  fetchEngagers,
  fetchNewFollows,
  fetchPostsInRange,
  fetchProfile,
} from "./bsky";
import type {
  AnalyzedPost,
  Engager,
  NewFollow,
  Profile,
} from "./bsky";
import { summarize } from "./analyze";
import type { Summary } from "./analyze";
import { useSession } from "./session";
import { aggregateNotifications } from "./notifications";
import { loadRecap, saveRecap } from "./recap-record";
import type { RecapRecord } from "./recap-record";
import "./App.css";

const SLIDE_DURATION_MS = 6000;

function normalizeHandle(raw: string): string {
  let h = raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .replace(/^@/, "")
    .toLowerCase();
  if (h.startsWith("https://bsky.app/profile/")) {
    h = h.slice("https://bsky.app/profile/".length).split("/")[0];
  }
  if (!h.includes(".") && h.length > 0) h = `${h}.bsky.social`;
  return h;
}

interface MonthValue {
  year: number;
  month: number;
}

function defaultMonth(): MonthValue {
  const now = new Date();
  if (now.getMonth() === 0) {
    return { year: now.getFullYear() - 1, month: 11 };
  }
  return { year: now.getFullYear(), month: now.getMonth() - 1 };
}

function monthLabel(m: MonthValue): string {
  return `${m.year}年${m.month + 1}月`;
}

export default function App() {
  const sess = useSession();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [engagers, setEngagers] = useState<Engager[]>([]);
  const [newFollows, setNewFollows] = useState<NewFollow[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const recapMonth = useMemo<MonthValue>(() => defaultMonth(), []);

  async function analyzeAuthenticated(): Promise<void> {
    if (!sess.agent || !sess.did) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    setSummary(null);
    setEngagers([]);
    setNewFollows([]);
    setAuthenticated(true);
    setPersisted(false);

    try {
      const rangeStart = new Date(recapMonth.year, recapMonth.month, 1);
      const rangeEnd = new Date(
        recapMonth.year,
        recapMonth.month + 1,
        1,
      );
      const startMs = rangeStart.getTime();
      const endMs = rangeEnd.getTime() - 1;

      const prof = await sess.agent.getProfile({ actor: sess.did });
      const p: Profile = {
        did: prof.data.did,
        handle: prof.data.handle,
        displayName: prof.data.displayName,
        avatar: prof.data.avatar,
        description: prof.data.description,
        followersCount: prof.data.followersCount,
        followsCount: prof.data.followsCount,
        postsCount: prof.data.postsCount,
      };
      setProfile(p);

      // 既存レキャップがあればまず表示
      const existing = await loadRecap(sess.agent, sess.did, rangeStart);
      if (existing) {
        applyRecord(existing, p, rangeStart, rangeEnd);
        setPersisted(true);
      }

      // 新規計算（常に再計算して上書き保存）
      const [posts, notif] = await Promise.all([
        fetchPostsInRange(sess.did, startMs, endMs),
        aggregateNotifications(sess.agent, startMs, endMs),
      ]);

      const sum = summarize(posts, rangeStart, rangeEnd);
      // notifications の実測値で上書き
      sum.totalLikes = notif.likesTotal;
      sum.totalReposts = notif.repostsTotal;
      sum.totalReplies = notif.repliesTotal;
      sum.totalQuotes = notif.quotesTotal;

      setSummary(sum);
      setEngagers(notif.engagers);
      setNewFollows(notif.newFollows);

      // PDS に保存
      try {
        await saveRecap({
          agent: sess.agent,
          did: sess.did,
          monthStart: rangeStart,
          monthLabel: monthLabel(recapMonth),
          summary: sum,
          engagers: notif.engagers,
          newFollows: notif.newFollows,
        });
        setPersisted(true);
      } catch (e) {
        console.warn("saveRecap failed", e);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "予期しないエラー");
    } finally {
      setLoading(false);
    }
  }

  async function analyzeAnonymous(e: FormEvent) {
    e.preventDefault();
    const handle = normalizeHandle(input);
    if (!handle) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    setSummary(null);
    setEngagers([]);
    setNewFollows([]);
    setAuthenticated(false);
    setPersisted(false);
    try {
      const p = await fetchProfile(handle);
      setProfile(p);

      const rangeStart = new Date(recapMonth.year, recapMonth.month, 1);
      const rangeEnd = new Date(
        recapMonth.year,
        recapMonth.month + 1,
        1,
      );
      const startMs = rangeStart.getTime();
      const endMs = rangeEnd.getTime() - 1;

      const fetched = await fetchPostsInRange(p.did, startMs, endMs);
      setSummary(summarize(fetched, rangeStart, rangeEnd));

      const topEngaged = fetched
        .filter(
          (f) =>
            f.kind !== "repost" && (f.likeCount > 0 || f.repostCount > 0),
        )
        .sort(
          (a, b) =>
            b.likeCount + b.repostCount - (a.likeCount + a.repostCount),
        )
        .slice(0, 15);
      if (topEngaged.length > 0) {
        fetchEngagers(
          topEngaged.map((t) => t.uri),
          p.did,
        )
          .then(setEngagers)
          .catch(() => {});
      }

      fetchNewFollows(p.did, startMs, endMs)
        .then(setNewFollows)
        .catch(() => {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "予期しないエラー");
    } finally {
      setLoading(false);
    }
  }

  function applyRecord(
    record: RecapRecord,
    p: Profile,
    rangeStart: Date,
    rangeEnd: Date,
  ): void {
    const sum: Summary = {
      total: record.posts,
      byKind: { original: 0, reply: 0, repost: 0, quote: 0 },
      totalLikes: record.likes,
      totalReposts: record.reposts,
      totalReplies: record.replies,
      totalQuotes: record.quotes,
      heatmap: record.heatmap,
      heatmapMax: record.heatmapMax,
      mostLiked: record.mostLikedUri
        ? {
            uri: record.mostLikedUri,
            createdAt: new Date(),
            kind: "original",
            text: record.mostLikedText ?? "",
            likeCount: record.mostLikedLikes ?? 0,
            repostCount: 0,
            replyCount: 0,
            quoteCount: 0,
            hashtags: [],
            mentions: [],
          }
        : undefined,
      rangeStart,
      rangeEnd,
    };
    setSummary(sum);
    setEngagers(
      record.topEngagers.map((e) => ({
        did: e.did,
        handle: e.handleSnapshot,
        displayName: e.displayNameSnapshot,
        avatar: e.avatarSnapshot,
        likes: e.likes,
        reposts: e.reposts,
      })),
    );
    setNewFollows(
      record.newFollows.map((f) => ({
        did: f.did,
        handle: f.handleSnapshot,
        displayName: f.displayNameSnapshot,
        avatar: f.avatarSnapshot,
        followedAt: new Date(f.followedAt),
      })),
    );
    void p;
  }

  async function onSignIn() {
    const handle = normalizeHandle(input);
    if (!handle) {
      setError("ハンドルを入れてください");
      return;
    }
    setSigningIn(true);
    setError(null);
    try {
      await sess.signIn(handle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ログインに失敗しました");
      setSigningIn(false);
    }
  }

  function reset() {
    setProfile(null);
    setSummary(null);
    setEngagers([]);
    setNewFollows([]);
    setError(null);
    setAuthenticated(false);
    setPersisted(false);
  }

  const hasData = !!(summary && profile);

  if (!hasData) {
    if (!sess.ready) {
      return (
        <div className="splash">
          <div className="splash-inner">
            <div className="splash-logo">SKY HIGHLIGHTS</div>
            <div className="splash-sub">読み込み中…</div>
          </div>
        </div>
      );
    }

    const loggedIn = !!sess.session;

    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="splash-logo">BSKY · MONTHLY RECAP</div>
          <h1 className="splash-title">
            Sky Highlights
            <br />
            <span className="splash-sub-title">
              {monthLabel(recapMonth)}を振り返る。
            </span>
          </h1>
          <p className="splash-sub">
            {loggedIn
              ? "ログイン済みです。あなたの正確なレキャップを作成できます。"
              : "ログインするとあなた自身の正確なレキャップが作れます。未ログインでも他の人のハンドルを覗けます。"}
          </p>

          {loggedIn ? (
            <div className="auth-box">
              <button
                type="button"
                className="btn-primary"
                onClick={analyzeAuthenticated}
                disabled={loading}
              >
                {loading ? "作成中…" : "自分のレキャップを見る"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={sess.signOut}
              >
                ログアウト
              </button>
            </div>
          ) : (
            <>
              <div className="auth-box">
                <input
                  type="text"
                  className="handle-input"
                  placeholder="alice.bsky.social"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={onSignIn}
                  disabled={signingIn || !input.trim()}
                >
                  {signingIn ? "遷移中…" : "Bluesky でログイン"}
                </button>
              </div>
              <div className="divider">または</div>
              <form className="form" onSubmit={analyzeAnonymous}>
                <input
                  type="text"
                  placeholder="他の人のハンドル (例: bsky.app)"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
                <button type="submit" disabled={loading || !input.trim()}>
                  {loading ? "…" : "見る"}
                </button>
              </form>
              <div className="auth-note">
                未ログインの場合は Top 3 は表示されません
              </div>
            </>
          )}

          {error && <div className="error">⚠ {error}</div>}
        </div>
      </div>
    );
  }

  return (
    <StoryViewer
      profile={profile!}
      summary={summary!}
      engagers={engagers}
      newFollows={newFollows}
      monthLabel={monthLabel(recapMonth)}
      authenticated={authenticated}
      persisted={persisted}
      onReset={reset}
    />
  );
}

interface StoryViewerProps {
  profile: Profile;
  summary: Summary;
  engagers: Engager[];
  newFollows: NewFollow[];
  monthLabel: string;
  authenticated: boolean;
  persisted: boolean;
  onReset: () => void;
}

interface Slide {
  key: string;
  render: () => React.ReactNode;
}

function StoryViewer({
  profile,
  summary,
  engagers,
  newFollows,
  monthLabel,
  authenticated,
  persisted,
  onReset,
}: StoryViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const slides = useMemo<Slide[]>(() => {
    const items: Slide[] = [
      {
        key: "intro",
        render: () => (
          <IntroSlide
            profile={profile}
            monthLabel={monthLabel}
            engagers={engagers}
          />
        ),
      },
      {
        key: "likes",
        render: () => (
          <LikesSlide
            summary={summary}
            engagers={engagers}
            authenticated={authenticated}
          />
        ),
      },
      {
        key: "reposts",
        render: () => (
          <RepostsSlide
            summary={summary}
            engagers={engagers}
            authenticated={authenticated}
          />
        ),
      },
      {
        key: "conversations",
        render: () => <ConversationsSlide summary={summary} />,
      },
      {
        key: "heatmap",
        render: () => <HeatmapSlide summary={summary} />,
      },
      {
        key: "follows",
        render: () => <NewFollowsSlide follows={newFollows} />,
      },
    ];
    if (summary.mostLiked) {
      items.push({
        key: "top",
        render: () => (
          <TopPostSlide post={summary.mostLiked!} profile={profile} />
        ),
      });
    }
    items.push({
      key: "summary",
      render: () => (
        <SummarySlide
          profile={profile}
          summary={summary}
          engagers={engagers}
          newFollows={newFollows}
          monthLabel={monthLabel}
          authenticated={authenticated}
          persisted={persisted}
        />
      ),
    });
    return items;
  }, [profile, summary, engagers, newFollows, monthLabel, authenticated, persisted]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setActive(Math.min(Math.max(0, idx), slides.length - 1));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [slides.length]);

  function goto(idx: number) {
    const el = viewportRef.current;
    if (!el) return;
    const clamped = Math.min(Math.max(0, idx), slides.length - 1);
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  }

  // Reset elapsed when slide changes
  useEffect(() => {
    setElapsed(0);
  }, [active]);

  // Auto-advance timer
  useEffect(() => {
    if (paused) return;
    if (active >= slides.length - 1 && elapsed >= SLIDE_DURATION_MS) return;
    const TICK_MS = 50;
    const interval = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + TICK_MS;
        if (next >= SLIDE_DURATION_MS) {
          clearInterval(interval);
          if (active < slides.length - 1) {
            setTimeout(() => goto(active + 1), 0);
          }
          return SLIDE_DURATION_MS;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [paused, active, slides.length]);

  function handlePointerDown() {
    setPaused(true);
  }
  function handlePointerUp() {
    setPaused(false);
  }

  return (
    <div
      className="viewer"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <header className="viewer-header">
        <div className="progress">
          {slides.map((s, i) => {
            let fillPct = 0;
            if (i < active) fillPct = 100;
            else if (i === active)
              fillPct = (elapsed / SLIDE_DURATION_MS) * 100;
            return (
              <span
                key={s.key}
                className="progress-bar"
                onClick={(e) => {
                  e.stopPropagation();
                  goto(i);
                }}
              >
                <span
                  className="progress-fill"
                  style={{ width: `${fillPct}%` }}
                />
              </span>
            );
          })}
        </div>
        <div className="viewer-user">
          {profile.avatar && (
            <img className="viewer-avatar" src={profile.avatar} alt="" />
          )}
          <div className="viewer-names">
            <div className="viewer-name">
              {profile.displayName || profile.handle}
            </div>
            <div className="viewer-handle">
              @{profile.handle} · {monthLabel}
            </div>
          </div>
          <button
            className="reset"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="戻る"
          >
            ×
          </button>
        </div>
      </header>
      <button
        className="nav prev"
        onClick={(e) => {
          e.stopPropagation();
          goto(active - 1);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={active === 0}
        aria-label="前へ"
      >
        ‹
      </button>
      <button
        className="nav next"
        onClick={(e) => {
          e.stopPropagation();
          goto(active + 1);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={active === slides.length - 1}
        aria-label="次へ"
      >
        ›
      </button>
      <div className="viewport" ref={viewportRef}>
        {slides.map((s) => (
          <div className="slide" key={s.key}>
            {s.render()}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================
   1. Intro
   ================ */

interface IntroProps {
  profile: Profile;
  monthLabel: string;
  engagers: Engager[];
}

const SCATTER_TL = [
  { top: "3%", left: "4%", size: 76 },
  { top: "2%", left: "34%", size: 52 },
  { top: "17%", left: "14%", size: 62 },
  { top: "14%", left: "42%", size: 44 },
  { top: "28%", left: "4%", size: 50 },
  { top: "29%", left: "30%", size: 58 },
  { top: "6%", left: "58%", size: 46 },
  { top: "22%", left: "58%", size: 40 },
];

const SCATTER_BR = [
  { bottom: "3%", right: "4%", size: 76 },
  { bottom: "2%", right: "34%", size: 52 },
  { bottom: "17%", right: "14%", size: 62 },
  { bottom: "14%", right: "42%", size: 44 },
  { bottom: "28%", right: "4%", size: 50 },
  { bottom: "29%", right: "30%", size: 58 },
  { bottom: "6%", right: "58%", size: 46 },
  { bottom: "22%", right: "58%", size: 40 },
];

function IntroSlide({ profile, monthLabel, engagers }: IntroProps) {
  const displayName = profile.displayName || profile.handle.split(".")[0];
  const tl = engagers.slice(0, SCATTER_TL.length);
  const br = engagers.slice(
    SCATTER_TL.length,
    SCATTER_TL.length + SCATTER_BR.length,
  );

  return (
    <div className="card grad-blue fill intro-card">
      <div className="scatter scatter-tl" aria-hidden="true">
        {tl.map((e, i) => (
          <ScatterAvatar key={e.did} engager={e} style={SCATTER_TL[i]} />
        ))}
      </div>
      <div className="scatter scatter-br" aria-hidden="true">
        {br.map((e, i) => (
          <ScatterAvatar key={e.did} engager={e} style={SCATTER_BR[i]} />
        ))}
      </div>
      <div className="card-body intro-body">
        <div className="intro-center">
          <div className="card-label">{monthLabel} recap</div>
          <div className="intro-title">
            <span className="intro-name-accent">{displayName}</span>
            <br />の{monthLabel.split("年")[1]}を
            <br />
            振り返りましょう
          </div>
          {engagers.length > 0 && (
            <div className="intro-engagers-note">
              {engagers.length}人 があなたに反応しました
            </div>
          )}
          <div className="swipe-hint">← スワイプで進む →</div>
        </div>
      </div>
    </div>
  );
}

interface ScatterAvatarProps {
  engager: Engager;
  style: { size: number } & CSSProperties;
}

function ScatterAvatar({ engager, style }: ScatterAvatarProps) {
  const { size, ...pos } = style;
  const dim = `${size}px`;
  return (
    <div
      className="scatter-avatar"
      style={{ ...pos, width: dim, height: dim }}
      title={`@${engager.handle}`}
    >
      {engager.avatar ? (
        <img src={engager.avatar} alt="" loading="lazy" />
      ) : (
        <div className="scatter-fallback">
          {engager.handle.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

/* ================
   2. Likes (件数 + top 3)
   ================ */

interface ReactionProps {
  summary: Summary;
  engagers: Engager[];
  authenticated: boolean;
}

function LikesSlide({ summary, engagers, authenticated }: ReactionProps) {
  const top3 = authenticated
    ? [...engagers]
        .filter((e) => e.likes > 0)
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 3)
    : [];
  return (
    <SplitReactionSlide
      gradient="grad-red"
      label="likes"
      emoji="♥"
      count={summary.totalLikes}
      countCaption="受け取ったいいね"
      top3Label="top 3 — いちばん ♥ してくれた人"
      top3={top3}
      countKey="likes"
      countIcon="♥"
      emptyText="まだ いいねはありません"
      authenticated={authenticated}
    />
  );
}

function RepostsSlide({ summary, engagers, authenticated }: ReactionProps) {
  const top3 = authenticated
    ? [...engagers]
        .filter((e) => e.reposts > 0)
        .sort((a, b) => b.reposts - a.reposts)
        .slice(0, 3)
    : [];
  return (
    <SplitReactionSlide
      gradient="grad-green"
      label="reposts"
      emoji="🔁"
      count={summary.totalReposts}
      countCaption="受け取ったリポスト"
      top3Label="top 3 — いちばん 🔁 してくれた人"
      top3={top3}
      countKey="reposts"
      countIcon="🔁"
      emptyText="まだ リポストはありません"
      authenticated={authenticated}
    />
  );
}

interface SplitReactionProps {
  gradient: string;
  label: string;
  emoji: string;
  count: number;
  countCaption: string;
  top3Label: string;
  top3: Engager[];
  countKey: "likes" | "reposts";
  countIcon: string;
  emptyText: string;
  authenticated: boolean;
}

function SplitReactionSlide({
  gradient,
  label,
  emoji,
  count,
  countCaption,
  top3Label,
  top3,
  countKey,
  countIcon,
  emptyText,
  authenticated,
}: SplitReactionProps) {
  return (
    <div className={`card ${gradient} fill`}>
      <div className="card-body split-body">
        <div className="split-top">
          <div className="card-label">{label}</div>
          <div className="reaction-emojis">
            <span className="reaction-emoji">{emoji}</span>
          </div>
          <div className="huge-number">
            <span>{count.toLocaleString()}</span>
          </div>
          <div className="reaction-caption">{countCaption}</div>
        </div>
        <div className="split-bottom">
          {authenticated ? (
            <>
              <div className="card-label small-label">{top3Label}</div>
              {top3.length === 0 ? (
                <div className="rank-empty">{emptyText}</div>
              ) : (
                <ul className="rank-list">
                  {top3.map((e, i) => (
                    <li key={e.did} className={`rank-item rank-${i + 1}`}>
                      <div className="rank-badge">{i + 1}</div>
                      {e.avatar ? (
                        <img
                          className="rank-avatar"
                          src={e.avatar}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <div className="rank-avatar rank-fallback">
                          {e.handle.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="rank-info">
                        <div className="rank-name">
                          {e.displayName || e.handle}
                        </div>
                        <div className="rank-handle">@{e.handle}</div>
                      </div>
                      <div className="rank-count">
                        <span className="rank-count-icon">{countIcon}</span>
                        {e[countKey]}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="auth-prompt">
              <div className="auth-prompt-icon">🔒</div>
              <div className="auth-prompt-text">
                ログインすると上位 3人 が見れます
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================
   3. Conversations (コメント + 引用)
   ================ */

function ConversationsSlide({ summary }: { summary: Summary }) {
  const total = summary.totalReplies + summary.totalQuotes;
  return (
    <div className="card grad-purple fill">
      <div className="card-body center">
        <div className="card-label">conversations</div>
        <div className="reaction-emojis">
          <span className="reaction-emoji">💬</span>
          <span className="reaction-plus">+</span>
          <span className="reaction-emoji">❝</span>
        </div>
        <div className="huge-number">
          <span>{total.toLocaleString()}</span>
        </div>
        <div className="reaction-caption">会話が生まれた回数</div>
        <div className="reaction-breakdown">
          <div className="rb-item">
            <span className="rb-icon">💬</span>
            <span className="rb-value">
              {summary.totalReplies.toLocaleString()}
            </span>
            <span className="rb-label">コメント</span>
          </div>
          <div className="rb-item">
            <span className="rb-icon">❝</span>
            <span className="rb-value">
              {summary.totalQuotes.toLocaleString()}
            </span>
            <span className="rb-label">引用</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================
   4. Heatmap (曜日 × 時間)
   ================ */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function HeatmapSlide({ summary }: { summary: Summary }) {
  const { heatmap } = summary;

  // 2時間ごとに集計（12 bins × 7 days）
  const bins: number[][] = [];
  let binMax = 0;
  for (let bin = 0; bin < 12; bin++) {
    const row = WEEKDAYS.map(
      (_, d) => heatmap[d][bin * 2] + heatmap[d][bin * 2 + 1],
    );
    bins.push(row);
    for (const v of row) if (v > binMax) binMax = v;
  }

  return (
    <div className="card card-dark fill">
      <div className="card-body">
        <div className="card-label">いつ投稿してた？</div>
        <div className="heatmap heatmap-2h">
          <div className="heatmap-corner" />
          {WEEKDAYS.map((d) => (
            <div key={d} className="heatmap-day-label">
              {d}
            </div>
          ))}
          {bins.map((row, bin) => (
            <HeatmapRow
              key={bin}
              bin={bin}
              row={row}
              max={binMax}
            />
          ))}
        </div>
        <div className="heatmap-caption">
          {summary.total > 0
            ? `2時間ごと / 1セル最大 ${binMax}件`
            : "この月は投稿がありませんでした"}
        </div>
      </div>
    </div>
  );
}

interface HeatmapRowProps {
  bin: number;
  row: number[];
  max: number;
}

function HeatmapRow({ bin, row, max }: HeatmapRowProps) {
  const hourStart = bin * 2;
  return (
    <>
      <div className="heatmap-hour-label">
        {hourStart}
        <span className="heatmap-hour-suffix">時</span>
      </div>
      {row.map((count, d) => {
        const intensity = max > 0 ? count / max : 0;
        const alpha = count > 0 ? Math.max(0.14, intensity * 0.95) : 0;
        return (
          <div
            key={d}
            className="heatmap-cell"
            style={{
              background:
                count > 0
                  ? `rgba(96, 165, 250, ${alpha})`
                  : "rgba(255,255,255,0.03)",
            }}
            title={`${WEEKDAYS[d]} ${hourStart}-${hourStart + 1}時: ${count}件`}
          >
            {count > 0 && max <= 9 ? (
              <span className="heatmap-count">{count}</span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/* ================
   5. New follows
   ================ */

function NewFollowsSlide({ follows }: { follows: NewFollow[] }) {
  if (follows.length === 0) {
    return (
      <div className="card grad-gold fill">
        <div className="card-body center">
          <div className="card-label">新しくフォローした友達</div>
          <div className="huge-number">
            <span>0</span>
            <span className="huge-suffix">人</span>
          </div>
          <div className="card-caption">
            この月は新しいフォローはありませんでした
          </div>
        </div>
      </div>
    );
  }

  const preview = follows.slice(0, 12);

  return (
    <div className="card grad-gold fill">
      <div className="card-body">
        <div className="card-label">新しくフォローした友達</div>
        <div className="follows-count">
          <span className="follows-number">{follows.length}</span>
          <span className="follows-suffix">人</span>
        </div>
        <ul className="follow-list">
          {preview.map((f) => (
            <li key={f.did} className="follow-item">
              {f.avatar ? (
                <img
                  className="follow-avatar"
                  src={f.avatar}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="follow-avatar follow-fallback">
                  {f.handle.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="follow-info">
                <div className="follow-name">
                  {f.displayName || f.handle}
                </div>
                <div className="follow-handle">@{f.handle}</div>
              </div>
            </li>
          ))}
        </ul>
        {follows.length > preview.length && (
          <div className="follows-more">
            +{follows.length - preview.length} 人
          </div>
        )}
      </div>
    </div>
  );
}

/* ================
   6. Top post
   ================ */

interface TopPostProps {
  post: AnalyzedPost;
  profile: Profile;
}

function TopPostSlide({ post, profile }: TopPostProps) {
  const rkey = post.uri.split("/").pop();
  const bskyUrl = `https://bsky.app/profile/${profile.handle}/post/${rkey}`;
  return (
    <div className="card grad-magenta fill">
      <div className="card-body">
        <div className="card-label">いちばん♥された投稿</div>
        <p className="top-post-text">{post.text || "(テキストなし)"}</p>
        <div className="top-post-stats">
          <span className="big-like">♥ {post.likeCount.toLocaleString()}</span>
          <span>🔁 {post.repostCount}</span>
          <span>💬 {post.replyCount}</span>
        </div>
        <div className="card-caption">
          {post.createdAt.toLocaleString("ja-JP")}
        </div>
        <a
          className="post-open"
          href={bskyUrl}
          target="_blank"
          rel="noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
        >
          Bluesky で開く ↗
        </a>
      </div>
    </div>
  );
}

/* ================
   7. Final summary (OGP-ready)
   ================ */

interface SummaryProps {
  profile: Profile;
  summary: Summary;
  engagers: Engager[];
  newFollows: NewFollow[];
  monthLabel: string;
  authenticated: boolean;
  persisted: boolean;
}

function SummarySlide({
  profile,
  summary,
  engagers,
  newFollows,
  monthLabel,
  authenticated,
  persisted,
}: SummaryProps) {
  const topSupporters = engagers.slice(0, 5);
  return (
    <div className="card card-summary fill">
      <div className="card-body summary-body">
        <div className="summary-head">
          <div className="summary-month">{monthLabel} · RECAP</div>
          <div className="summary-profile">
            {profile.avatar && (
              <img
                className="summary-avatar"
                src={profile.avatar}
                alt=""
              />
            )}
            <div className="summary-profile-text">
              <div className="summary-name">
                {profile.displayName || profile.handle}
              </div>
              <div className="summary-handle">@{profile.handle}</div>
            </div>
          </div>
        </div>

        <div className="summary-grid">
          <SummaryStat
            label="投稿"
            value={summary.total}
            color="#60a5fa"
          />
          <SummaryStat
            label="♥ いいね"
            value={summary.totalLikes}
            color="#f472b6"
          />
          <SummaryStat
            label="🔁 リポスト"
            value={summary.totalReposts}
            color="#34d399"
          />
          <SummaryStat
            label="💬 コメント"
            value={summary.totalReplies}
            color="#fbbf24"
          />
          <SummaryStat
            label="❝ 引用"
            value={summary.totalQuotes}
            color="#c084fc"
          />
          <SummaryStat
            label="新フォロー"
            value={newFollows.length}
            color="#fb923c"
          />
        </div>

        {topSupporters.length > 0 && (
          <div className="summary-supporters">
            <div className="summary-thanks">thanks to</div>
            <div className="supporter-avatars">
              {topSupporters.map((e) => (
                <div
                  key={e.did}
                  className="supporter-avatar"
                  title={`@${e.handle}`}
                >
                  {e.avatar ? (
                    <img src={e.avatar} alt="" loading="lazy" />
                  ) : (
                    <div className="supporter-fallback">
                      {e.handle.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              ))}
              {engagers.length > topSupporters.length && (
                <div className="supporter-more">
                  +{engagers.length - topSupporters.length}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="summary-footer">
          <span className="summary-brand">sky highlights</span>
          {authenticated && persisted && (
            <span className="summary-persist">✓ PDS に保存済み</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="summary-stat">
      <div className="summary-stat-value" style={{ color }}>
        {value.toLocaleString()}
      </div>
      <div className="summary-stat-label">{label}</div>
    </div>
  );
}
