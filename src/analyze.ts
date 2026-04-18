import type { AnalyzedPost, PostKind } from "./bsky";

export type Summary = {
  total: number;
  byKind: Record<PostKind, number>;
  totalLikes: number;
  totalReposts: number;
  totalReplies: number;
  totalQuotes: number;
  heatmap: number[][];
  heatmapMax: number;
  mostLiked?: AnalyzedPost;
  rangeStart: Date;
  rangeEnd: Date;
};

export function summarize(
  posts: AnalyzedPost[],
  rangeStart: Date,
  rangeEnd: Date,
): Summary {
  const byKind: Record<PostKind, number> = {
    original: 0,
    reply: 0,
    repost: 0,
    quote: 0,
  };
  let totalLikes = 0;
  let totalReposts = 0;
  let totalReplies = 0;
  let totalQuotes = 0;
  let mostLiked: AnalyzedPost | undefined;

  const heatmap: number[][] = Array.from({ length: 7 }, () =>
    new Array<number>(24).fill(0),
  );
  let heatmapMax = 0;

  for (const p of posts) {
    byKind[p.kind]++;
    totalLikes += p.likeCount;
    totalReposts += p.repostCount;
    totalReplies += p.replyCount;
    totalQuotes += p.quoteCount;

    if (p.kind !== "repost") {
      if (!mostLiked || p.likeCount > mostLiked.likeCount) mostLiked = p;
    }

    const day = p.createdAt.getDay();
    const hour = p.createdAt.getHours();
    heatmap[day][hour]++;
    if (heatmap[day][hour] > heatmapMax) heatmapMax = heatmap[day][hour];
  }

  return {
    total: posts.length,
    byKind,
    totalLikes,
    totalReposts,
    totalReplies,
    totalQuotes,
    heatmap,
    heatmapMax,
    mostLiked,
    rangeStart,
    rangeEnd,
  };
}
