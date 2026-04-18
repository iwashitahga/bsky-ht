import type { AnalyzedPost, PostKind } from "./bsky";

export type DayBucket = {
  label: string;
  date: Date;
  total: number;
  byKind: Record<PostKind, number>;
};

export type Summary = {
  total: number;
  byKind: Record<PostKind, number>;
  totalLikes: number;
  totalReposts: number;
  totalReplies: number;
  totalQuotes: number;
  days: DayBucket[];
  hourly: number[];
  topHashtags: Array<{ tag: string; count: number }>;
  topMentions: Array<{ handle: string; count: number }>;
  mostLiked?: AnalyzedPost;
};

export function summarize(posts: AnalyzedPost[], days = 7): Summary {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  const dayBuckets: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - i);
    dayBuckets.push({
      label: formatDayLabel(d),
      date: d,
      total: 0,
      byKind: { original: 0, reply: 0, repost: 0, quote: 0 },
    });
  }

  const hourly = new Array<number>(24).fill(0);
  const byKind: Record<PostKind, number> = {
    original: 0,
    reply: 0,
    repost: 0,
    quote: 0,
  };
  const tagCount = new Map<string, number>();
  const mentionCount = new Map<string, number>();
  let totalLikes = 0;
  let totalReposts = 0;
  let totalReplies = 0;
  let totalQuotes = 0;
  let mostLiked: AnalyzedPost | undefined;

  for (const p of posts) {
    byKind[p.kind]++;
    totalLikes += p.likeCount;
    totalReposts += p.repostCount;
    totalReplies += p.replyCount;
    totalQuotes += p.quoteCount;

    if (!mostLiked || p.likeCount > mostLiked.likeCount) mostLiked = p;

    const dayIndex = dayBuckets.findIndex(
      (b) => sameDay(b.date, p.createdAt),
    );
    if (dayIndex >= 0) {
      dayBuckets[dayIndex].total++;
      dayBuckets[dayIndex].byKind[p.kind]++;
    }
    hourly[p.createdAt.getHours()]++;

    for (const t of p.hashtags) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
    for (const m of p.mentions) {
      mentionCount.set(m, (mentionCount.get(m) ?? 0) + 1);
    }
  }

  const topHashtags = [...tagCount.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const topMentions = [...mentionCount.entries()]
    .map(([handle, count]) => ({ handle, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total: posts.length,
    byKind,
    totalLikes,
    totalReposts,
    totalReplies,
    totalQuotes,
    days: dayBuckets,
    hourly,
    topHashtags,
    topMentions,
    mostLiked,
  };
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayLabel(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const w = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${m}/${day}(${w})`;
}
