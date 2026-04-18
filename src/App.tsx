import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { fetchEngagers, fetchProfile, fetchRecentPosts } from "./bsky";
import type { AnalyzedPost, Engager, Profile } from "./bsky";
import { summarize } from "./analyze";
import type { DayBucket, Summary } from "./analyze";
import "./App.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
);

const DAYS = 7;

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

export default function App() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [posts, setPosts] = useState<AnalyzedPost[]>([]);
  const [engagers, setEngagers] = useState<Engager[]>([]);

  const sortedPosts = useMemo(
    () =>
      [...posts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [posts],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const handle = normalizeHandle(input);
    if (!handle) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    setSummary(null);
    setPosts([]);
    setEngagers([]);
    try {
      const p = await fetchProfile(handle);
      setProfile(p);
      const sinceMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;
      const fetched = await fetchRecentPosts(p.did, sinceMs);
      setPosts(fetched);
      setSummary(summarize(fetched, DAYS));

      const topEngaged = fetched
        .filter(
          (f) =>
            f.kind !== "repost" && (f.likeCount > 0 || f.repostCount > 0),
        )
        .sort(
          (a, b) => b.likeCount + b.repostCount - (a.likeCount + a.repostCount),
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "予期しないエラー");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setProfile(null);
    setSummary(null);
    setPosts([]);
    setEngagers([]);
    setError(null);
  }

  const hasData = !!(summary && summary.total > 0 && profile);

  if (!hasData) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="splash-logo">BSKY · WEEKLY</div>
          <h1 className="splash-title">今週のあなたを
            <br />
            ストーリーで。
          </h1>
          <p className="splash-sub">
            Bluesky ハンドルを入れると、過去7日間の活動を一画面ずつまとめます。
          </p>
          <form className="form" onSubmit={onSubmit}>
            <input
              type="text"
              placeholder="ハンドル (例: bsky.app)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
            <button type="submit" disabled={loading || !input.trim()}>
              {loading ? "…" : "見る"}
            </button>
          </form>
          {summary && summary.total === 0 && (
            <div className="splash-empty">
              過去7日間の投稿・リポストは見つかりませんでした。
            </div>
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
      posts={sortedPosts}
      engagers={engagers}
      onReset={reset}
    />
  );
}

interface StoryViewerProps {
  profile: Profile;
  summary: Summary;
  posts: AnalyzedPost[];
  engagers: Engager[];
  onReset: () => void;
}

function StoryViewer({
  profile,
  summary,
  posts,
  engagers,
  onReset,
}: StoryViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const slides = useMemo<Slide[]>(() => {
    const items: Slide[] = [
      {
        key: "intro",
        render: () => (
          <IntroSlide
            profile={profile}
            summary={summary}
            engagers={engagers}
          />
        ),
      },
      {
        key: "likes",
        render: () => (
          <EngagementSlide
            icon="♥"
            label="受け取ったいいね"
            value={summary.totalLikes}
            avgBase={summary.total}
            gradient="grad-red"
            caption={engagementCaption(summary.totalLikes)}
          />
        ),
      },
      {
        key: "reposts",
        render: () => (
          <EngagementSlide
            icon="🔁"
            label="リポストされた数"
            value={summary.totalReposts}
            avgBase={summary.total}
            gradient="grad-green"
            caption="あなたの投稿が広がった回数"
          />
        ),
      },
      {
        key: "replies",
        render: () => (
          <EngagementSlide
            icon="💬"
            label="リプライされた数"
            value={summary.totalReplies}
            avgBase={summary.total}
            gradient="grad-amber"
            caption="会話が生まれた回数"
          />
        ),
      },
      {
        key: "quotes",
        render: () => (
          <EngagementSlide
            icon="❝"
            label="引用された数"
            value={summary.totalQuotes}
            avgBase={summary.total}
            gradient="grad-purple"
            caption="引用投稿された回数"
          />
        ),
      },
      {
        key: "count",
        render: () => (
          <BigStatSlide
            label="週間投稿"
            value={summary.total}
            suffix="件"
            gradient="grad-pink"
            caption={captionForPostCount(summary.total)}
          />
        ),
      },
      { key: "daily", render: () => <DailyChartSlide summary={summary} /> },
      { key: "busy", render: () => <BusiestDaySlide summary={summary} /> },
      { key: "peak", render: () => <PeakHourSlide summary={summary} /> },
      { key: "kind", render: () => <KindSlide summary={summary} /> },
    ];
    if (summary.topHashtags.length > 0) {
      items.push({ key: "tags", render: () => <HashtagSlide summary={summary} /> });
    }
    if (summary.topMentions.length > 0) {
      items.push({ key: "mentions", render: () => <MentionSlide summary={summary} /> });
    }
    if (summary.mostLiked) {
      items.push({
        key: "top",
        render: () => (
          <TopPostSlide post={summary.mostLiked!} profile={profile} />
        ),
      });
    }
    items.push({
      key: "feed",
      render: () => <FeedSlide posts={posts} profile={profile} />,
    });
    return items;
  }, [profile, summary, posts, engagers]);

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

  return (
    <div className="viewer">
      <header className="viewer-header">
        <div className="progress">
          {slides.map((s, i) => (
            <span
              key={s.key}
              className={`progress-bar ${i <= active ? "on" : ""}`}
              onClick={() => goto(i)}
            />
          ))}
        </div>
        <div className="viewer-user">
          {profile.avatar && (
            <img className="viewer-avatar" src={profile.avatar} alt="" />
          )}
          <div className="viewer-names">
            <div className="viewer-name">
              {profile.displayName || profile.handle}
            </div>
            <div className="viewer-handle">@{profile.handle}</div>
          </div>
          <button
            className="reset"
            onClick={onReset}
            aria-label="別のハンドルで見る"
          >
            ×
          </button>
        </div>
      </header>
      <button
        className="nav prev"
        onClick={() => goto(active - 1)}
        disabled={active === 0}
        aria-label="前へ"
      >
        ‹
      </button>
      <button
        className="nav next"
        onClick={() => goto(active + 1)}
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

interface Slide {
  key: string;
  render: () => React.ReactNode;
}

function engagementCaption(v: number): string {
  if (v >= 1000) return "今週、めちゃくちゃ届いています";
  if (v >= 100) return "しっかりとリアクションが";
  if (v >= 10) return "ちょっとずつ届いています";
  return "ゆっくりと";
}

function captionForPostCount(n: number): string {
  if (n >= 100) return "めちゃくちゃ活発な一週間";
  if (n >= 50) return "とても活発な一週間";
  if (n >= 20) return "順調に活動中";
  if (n >= 7) return "毎日ちょこちょこ";
  return "ゆるめのペース";
}

function avg(a: number, b: number): string {
  if (!b) return "0";
  return (a / b).toFixed(1);
}

/* ================
   Slide components
   ================ */

interface IntroProps {
  profile: Profile;
  summary: Summary;
  engagers: Engager[];
}

const SCATTER_TL = [
  { top: "3%", left: "4%", size: 78 },
  { top: "2%", left: "34%", size: 54 },
  { top: "17%", left: "14%", size: 62 },
  { top: "14%", left: "42%", size: 44 },
  { top: "28%", left: "4%", size: 50 },
  { top: "29%", left: "30%", size: 58 },
  { top: "6%", left: "58%", size: 48 },
  { top: "22%", left: "58%", size: 40 },
];

const SCATTER_BR = [
  { bottom: "3%", right: "4%", size: 78 },
  { bottom: "2%", right: "34%", size: 54 },
  { bottom: "17%", right: "14%", size: 62 },
  { bottom: "14%", right: "42%", size: 44 },
  { bottom: "28%", right: "4%", size: 50 },
  { bottom: "29%", right: "30%", size: 58 },
  { bottom: "6%", right: "58%", size: 48 },
  { bottom: "22%", right: "58%", size: 40 },
];

function IntroSlide({ profile, summary, engagers }: IntroProps) {
  const first = summary.days[0]?.label;
  const last = summary.days[summary.days.length - 1]?.label;
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
          <div className="card-label">2026 weekly recap</div>
          <div className="intro-title">
            <span className="intro-name-accent">{displayName}</span>
            <br />
            の一週間を
            <br />
            振り返りましょう
          </div>
          <div className="intro-range">
            {first} 〜 {last}
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
  style: React.CSSProperties & { size: number };
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

interface EngagementSlideProps {
  icon: string;
  label: string;
  value: number;
  avgBase: number;
  gradient: string;
  caption: string;
}

function EngagementSlide({
  icon,
  label,
  value,
  avgBase,
  gradient,
  caption,
}: EngagementSlideProps) {
  return (
    <div className={`card ${gradient} fill`}>
      <div className="card-body center">
        <div className="eng-icon">{icon}</div>
        <div className="card-label">{label}</div>
        <div className="huge-number">{value.toLocaleString()}</div>
        <div className="card-caption">
          {caption}
          <br />
          <span className="sub-caption">
            1投稿あたり 平均 {avg(value, avgBase)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface BigStatSlideProps {
  label: string;
  value: number;
  suffix?: string;
  gradient: string;
  caption?: string;
}

function BigStatSlide({
  label,
  value,
  suffix,
  gradient,
  caption,
}: BigStatSlideProps) {
  return (
    <div className={`card ${gradient} fill`}>
      <div className="card-body center">
        <div className="card-label">{label}</div>
        <div className="huge-number">
          <span>{value.toLocaleString()}</span>
          {suffix && <span className="huge-suffix">{suffix}</span>}
        </div>
        {caption && <div className="card-caption">{caption}</div>}
      </div>
    </div>
  );
}

function BusiestDaySlide({ summary }: { summary: Summary }) {
  const busiest = summary.days.reduce<DayBucket>(
    (best, d) => (d.total > best.total ? d : best),
    summary.days[0],
  );
  return (
    <div className="card grad-indigo fill">
      <div className="card-body center">
        <div className="card-label">一番活発だった日</div>
        <div className="huge-text">{busiest.label}</div>
        <div className="card-caption">
          この日だけで <strong>{busiest.total}</strong>件 投稿
        </div>
      </div>
    </div>
  );
}

function PeakHourSlide({ summary }: { summary: Summary }) {
  const peak = summary.hourly.reduce(
    (acc, v, i) => (v > acc.v ? { v, i } : acc),
    { v: 0, i: 0 },
  );
  return (
    <div className="card grad-sky fill">
      <div className="card-body center">
        <div className="card-label">ピーク時間帯</div>
        <div className="huge-number">
          <span>{peak.i}</span>
          <span className="huge-suffix">:00 台</span>
        </div>
        <div className="card-caption">
          {hourZoneLabel(peak.i)}に最もよく投稿
          <br />
          <span className="sub-caption">{peak.v}件</span>
        </div>
      </div>
    </div>
  );
}

function hourZoneLabel(h: number): string {
  if (h >= 5 && h < 12) return "朝";
  if (h >= 12 && h < 17) return "昼";
  if (h >= 17 && h < 21) return "夕方";
  return "夜";
}

function DailyChartSlide({ summary }: { summary: Summary }) {
  const data = {
    labels: summary.days.map((d) => d.label),
    datasets: (["original", "reply", "quote", "repost"] as const).map((k) => ({
      label: KIND_LABEL[k],
      data: summary.days.map((d) => d.byKind[k]),
      backgroundColor: CHART_COLORS[k],
      borderRadius: 4,
    })),
  };
  return (
    <div className="card card-dark fill">
      <div className="card-body">
        <div className="card-label">日別アクティビティ</div>
        <div className="chart-fill">
          <Bar
            data={data}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: {
                  stacked: true,
                  grid: { display: false },
                  ticks: { color: "rgba(255,255,255,0.7)" },
                },
                y: {
                  stacked: true,
                  ticks: { precision: 0, color: "rgba(255,255,255,0.5)" },
                  grid: { color: "rgba(255,255,255,0.08)" },
                },
              },
              plugins: {
                legend: {
                  position: "bottom",
                  labels: {
                    boxWidth: 10,
                    color: "rgba(255,255,255,0.85)",
                    font: { size: 12 },
                  },
                },
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}

function KindSlide({ summary }: { summary: Summary }) {
  const total = summary.total || 1;
  const kinds = (["original", "reply", "quote", "repost"] as const).filter(
    (k) => summary.byKind[k] > 0,
  );
  return (
    <div className="card card-dark fill">
      <div className="card-body center">
        <div className="card-label">投稿の内訳</div>
        <div className="kind-bar-big">
          {kinds.map((k) => (
            <span
              key={k}
              className="kind-seg"
              style={{
                width: `${(summary.byKind[k] / total) * 100}%`,
                background: CHART_COLORS[k],
              }}
            />
          ))}
        </div>
        <ul className="kind-legend">
          {kinds.map((k) => (
            <li key={k}>
              <span className="dot" style={{ background: CHART_COLORS[k] }} />
              <span>{KIND_LABEL[k]}</span>
              <span className="kind-count">
                {summary.byKind[k]} ·{" "}
                {Math.round((summary.byKind[k] / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HashtagSlide({ summary }: { summary: Summary }) {
  const top = summary.topHashtags.slice(0, 5);
  return (
    <div className="card grad-amber fill">
      <div className="card-body">
        <div className="card-label">よく使うハッシュタグ</div>
        <ul className="tag-list">
          {top.map((t, i) => (
            <li key={t.tag}>
              <span className="tag-rank">#{i + 1}</span>
              <span className="tag-label">#{t.tag}</span>
              <span className="tag-count">{t.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MentionSlide({ summary }: { summary: Summary }) {
  const top = summary.topMentions.slice(0, 5);
  return (
    <div className="card grad-purple fill">
      <div className="card-body">
        <div className="card-label">よく話している相手</div>
        <ul className="tag-list">
          {top.map((m, i) => (
            <li key={m.handle}>
              <span className="tag-rank">#{i + 1}</span>
              <span className="tag-label">@{m.handle}</span>
              <span className="tag-count">{m.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface TopPostSlideProps {
  post: AnalyzedPost;
  profile: Profile;
}

function TopPostSlide({ post, profile }: TopPostSlideProps) {
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
        >
          Bluesky で開く ↗
        </a>
      </div>
    </div>
  );
}

interface FeedSlideProps {
  posts: AnalyzedPost[];
  profile: Profile;
}

function FeedSlide({ posts, profile }: FeedSlideProps) {
  return (
    <div className="card card-feed fill">
      <div className="card-body feed-body-wrap">
        <div className="card-label feed-label">タイムライン</div>
        <ul className="feed-list">
          {posts.map((p) => (
            <FeedItem key={p.uri} post={p} profile={profile} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function FeedItem({ post, profile }: { post: AnalyzedPost; profile: Profile }) {
  const rkey = post.uri.split("/").pop();
  const bskyUrl = `https://bsky.app/profile/${profile.handle}/post/${rkey}`;
  const isRepost = post.kind === "repost";
  return (
    <li className="feed-item">
      <div
        className="feed-dot"
        style={{ background: CHART_COLORS[post.kind] }}
      />
      <div className="feed-body">
        <div className="feed-meta">
          <span className={`kind-tag kind-${post.kind}`}>
            {KIND_LABEL[post.kind]}
          </span>
          <span className="feed-time">{formatRelative(post.createdAt)}</span>
        </div>
        <p className={`feed-text ${isRepost ? "muted" : ""}`}>
          {post.text || (isRepost ? "（リポスト元の投稿）" : "")}
        </p>
        {!isRepost ? (
          <div className="feed-stats">
            <span>♥ {post.likeCount}</span>
            <span>🔁 {post.repostCount}</span>
            <span>💬 {post.replyCount}</span>
            <a href={bskyUrl} target="_blank" rel="noreferrer">
              ↗
            </a>
          </div>
        ) : (
          <div className="feed-stats">
            <a href={bskyUrl} target="_blank" rel="noreferrer">
              元の投稿 ↗
            </a>
          </div>
        )}
      </div>
    </li>
  );
}

const CHART_COLORS = {
  original: "#60a5fa",
  reply: "#fbbf24",
  quote: "#c084fc",
  repost: "#34d399",
} as const;

const KIND_LABEL: Record<string, string> = {
  original: "オリジナル",
  reply: "リプライ",
  quote: "引用",
  repost: "リポスト",
};

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}日前`;
  return d.toLocaleDateString("ja-JP");
}
