import { useMemo, useState } from "react";
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
import { fetchProfile, fetchRecentPosts } from "./bsky";
import type { AnalyzedPost, Profile } from "./bsky";
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
    try {
      const p = await fetchProfile(handle);
      setProfile(p);
      const sinceMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;
      const fetched = await fetchRecentPosts(p.did, sinceMs);
      setPosts(fetched);
      setSummary(summarize(fetched, DAYS));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "予期しないエラー");
    } finally {
      setLoading(false);
    }
  }

  const hasData = summary && summary.total > 0 && profile;

  return (
    <div className="app">
      <header className="hero">
        <div className="logo">BSKY · WEEKLY</div>
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
        {error && <div className="error">⚠ {error}</div>}
      </header>

      {summary && summary.total === 0 && (
        <div className="empty">
          過去7日間の投稿・リポストは見つかりませんでした。
        </div>
      )}

      {hasData && (
        <main className="cards">
          <IntroCard profile={profile} summary={summary} />
          <BigStatCard
            label="週間投稿"
            value={summary.total}
            suffix="件"
            gradient="grad-pink"
            caption={captionForPostCount(summary.total)}
          />
          <BigStatCard
            label="受け取ったいいね"
            value={summary.totalLikes}
            suffix="♥"
            gradient="grad-red"
            caption={`1投稿あたり 平均 ${avg(summary.totalLikes, summary.total)}♥`}
          />
          <BusiestDayCard summary={summary} />
          <PeakHourCard summary={summary} />
          <DailyChartCard summary={summary} />
          <KindCard summary={summary} />
          <EngagementMixCard summary={summary} />
          {summary.topHashtags.length > 0 && (
            <HashtagCard summary={summary} />
          )}
          {summary.topMentions.length > 0 && (
            <MentionCard summary={summary} />
          )}
          {summary.mostLiked && (
            <TopPostCard post={summary.mostLiked} profile={profile} />
          )}
          <FeedCard posts={sortedPosts} profile={profile} />
        </main>
      )}

      <footer className="footer">
        {posts.length > 0 && <>取得 {posts.length} 件 · </>}Public AppView 経由
      </footer>
    </div>
  );
}

function avg(a: number, b: number): string {
  if (!b) return "0";
  return (a / b).toFixed(1);
}

function captionForPostCount(n: number): string {
  if (n >= 100) return "めちゃくちゃ活発な一週間";
  if (n >= 50) return "とても活発な一週間";
  if (n >= 20) return "順調に活動中";
  if (n >= 7) return "毎日ちょこちょこ";
  return "ゆるめのペース";
}

interface IntroCardProps {
  profile: Profile;
  summary: Summary;
}

function IntroCard({ profile, summary }: IntroCardProps) {
  const range = `${summary.days[0]?.label} - ${summary.days[summary.days.length - 1]?.label}`;
  return (
    <section className="card card-intro">
      <div className="intro-head">
        {profile.avatar && (
          <img className="intro-avatar" src={profile.avatar} alt="" />
        )}
        <div>
          <div className="intro-name">
            {profile.displayName || profile.handle}
          </div>
          <div className="intro-handle">@{profile.handle}</div>
        </div>
      </div>
      <div className="intro-title">今週のハイライト</div>
      <div className="intro-range">{range}</div>
    </section>
  );
}

interface BigStatProps {
  label: string;
  value: number;
  suffix?: string;
  gradient: string;
  caption?: string;
}

function BigStatCard({
  label,
  value,
  suffix,
  gradient,
  caption,
}: BigStatProps) {
  return (
    <section className={`card ${gradient}`}>
      <div className="card-label">{label}</div>
      <div className="big-number">
        <span>{value.toLocaleString()}</span>
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
      {caption && <div className="card-caption">{caption}</div>}
    </section>
  );
}

function BusiestDayCard({ summary }: { summary: Summary }) {
  const busiest = summary.days.reduce<DayBucket>(
    (best, d) => (d.total > best.total ? d : best),
    summary.days[0],
  );
  return (
    <section className="card grad-indigo">
      <div className="card-label">一番活発だった日</div>
      <div className="big-number">
        <span>{busiest.label}</span>
      </div>
      <div className="card-caption">
        この日だけで {busiest.total}件 投稿
      </div>
    </section>
  );
}

function PeakHourCard({ summary }: { summary: Summary }) {
  const peak = summary.hourly.reduce(
    (acc, v, i) => (v > acc.v ? { v, i } : acc),
    { v: 0, i: 0 },
  );
  const zone = hourZoneLabel(peak.i);
  return (
    <section className="card grad-sky">
      <div className="card-label">ピーク時間帯</div>
      <div className="big-number">
        <span>{peak.i}</span>
        <span className="suffix">:00 台</span>
      </div>
      <div className="card-caption">
        {zone}に最もよく投稿しています（{peak.v}件）
      </div>
    </section>
  );
}

function hourZoneLabel(h: number): string {
  if (h >= 5 && h < 12) return "朝";
  if (h >= 12 && h < 17) return "昼";
  if (h >= 17 && h < 21) return "夕方";
  return "夜";
}

function DailyChartCard({ summary }: { summary: Summary }) {
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
    <section className="card card-dark">
      <div className="card-label">日別アクティビティ</div>
      <div className="chart-wrap">
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
                  color: "rgba(255,255,255,0.8)",
                  font: { size: 11 },
                },
              },
            },
          }}
        />
      </div>
    </section>
  );
}

function KindCard({ summary }: { summary: Summary }) {
  const total = summary.total || 1;
  const kinds = (["original", "reply", "quote", "repost"] as const).filter(
    (k) => summary.byKind[k] > 0,
  );
  return (
    <section className="card card-dark">
      <div className="card-label">投稿の内訳</div>
      <div className="kind-bar">
        {kinds.map((k) => (
          <span
            key={k}
            className="kind-seg"
            style={{
              width: `${(summary.byKind[k] / total) * 100}%`,
              background: CHART_COLORS[k],
            }}
            title={`${KIND_LABEL[k]}: ${summary.byKind[k]}`}
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
    </section>
  );
}

function EngagementMixCard({ summary }: { summary: Summary }) {
  return (
    <section className="card grad-green">
      <div className="card-label">エンゲージメント</div>
      <div className="eng-row">
        <EngStat v={summary.totalLikes} l="♥ いいね" />
        <EngStat v={summary.totalReposts} l="🔁 リポスト" />
        <EngStat v={summary.totalReplies} l="💬 リプライ" />
        <EngStat v={summary.totalQuotes} l="❝ 引用" />
      </div>
    </section>
  );
}

function EngStat({ v, l }: { v: number; l: string }) {
  return (
    <div className="eng-item">
      <div className="eng-v">{v.toLocaleString()}</div>
      <div className="eng-l">{l}</div>
    </div>
  );
}

function HashtagCard({ summary }: { summary: Summary }) {
  const top = summary.topHashtags.slice(0, 5);
  return (
    <section className="card grad-amber">
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
    </section>
  );
}

function MentionCard({ summary }: { summary: Summary }) {
  const top = summary.topMentions.slice(0, 5);
  return (
    <section className="card grad-purple">
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
    </section>
  );
}

interface TopPostProps {
  post: AnalyzedPost;
  profile: Profile;
}

function TopPostCard({ post, profile }: TopPostProps) {
  const rkey = post.uri.split("/").pop();
  const bskyUrl = `https://bsky.app/profile/${profile.handle}/post/${rkey}`;
  return (
    <a
      className="card card-top-post"
      href={bskyUrl}
      target="_blank"
      rel="noreferrer"
    >
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
    </a>
  );
}

interface FeedCardProps {
  posts: AnalyzedPost[];
  profile: Profile;
}

function FeedCard({ posts, profile }: FeedCardProps) {
  return (
    <section className="card card-feed">
      <div className="card-label">タイムライン</div>
      <ul className="feed-list">
        {posts.map((p) => (
          <FeedItem key={p.uri} post={p} profile={profile} />
        ))}
      </ul>
    </section>
  );
}

function FeedItem({ post, profile }: { post: AnalyzedPost; profile: Profile }) {
  const rkey = post.uri.split("/").pop();
  const bskyUrl = `https://bsky.app/profile/${profile.handle}/post/${rkey}`;
  const isRepost = post.kind === "repost";
  return (
    <li className="feed-item">
      <div className="feed-dot" style={{ background: CHART_COLORS[post.kind] }} />
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
        {!isRepost && (
          <div className="feed-stats">
            <span>♥ {post.likeCount}</span>
            <span>🔁 {post.repostCount}</span>
            <span>💬 {post.replyCount}</span>
            <a href={bskyUrl} target="_blank" rel="noreferrer">
              ↗
            </a>
          </div>
        )}
        {isRepost && (
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

