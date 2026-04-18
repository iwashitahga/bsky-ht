const PUBLIC_APPVIEW = "https://public.api.bsky.app";

export type Profile = {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
};

type Facet = {
  features: Array<{
    $type: string;
    tag?: string;
    did?: string;
    handle?: string;
  }>;
};

type PostRecord = {
  text?: string;
  createdAt: string;
  facets?: Facet[];
  reply?: unknown;
  embed?: { $type?: string };
};

type FeedItem = {
  post: {
    uri: string;
    cid: string;
    author: { did: string; handle: string };
    record: PostRecord;
    replyCount?: number;
    repostCount?: number;
    likeCount?: number;
    quoteCount?: number;
    indexedAt: string;
  };
  reply?: unknown;
  reason?: { $type: string; by?: { did: string; handle: string } };
};

export type PostKind = "original" | "reply" | "repost" | "quote";

export type AnalyzedPost = {
  uri: string;
  createdAt: Date;
  kind: PostKind;
  text: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  hashtags: string[];
  mentions: string[];
};

export async function fetchProfile(handle: string): Promise<Profile> {
  const url = `${PUBLIC_APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`プロフィール取得に失敗しました (${res.status}): ${body}`);
  }
  return (await res.json()) as Profile;
}

export async function fetchRecentPosts(
  actor: string,
  sinceMs: number,
): Promise<AnalyzedPost[]> {
  const out: AnalyzedPost[] = [];
  let cursor: string | undefined;
  const MAX_PAGES = 10;

  for (let i = 0; i < MAX_PAGES; i++) {
    const params = new URLSearchParams({
      actor,
      limit: "100",
      filter: "posts_with_replies",
    });
    if (cursor) params.set("cursor", cursor);
    const url = `${PUBLIC_APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`フィード取得に失敗しました (${res.status}): ${body}`);
    }
    const json = (await res.json()) as { feed: FeedItem[]; cursor?: string };
    let reachedEnd = false;

    for (const item of json.feed) {
      const ts = pickTimestamp(item);
      if (ts.getTime() < sinceMs) {
        reachedEnd = true;
        continue;
      }
      const analyzed = analyzeItem(item, actor, ts);
      if (analyzed) out.push(analyzed);
    }

    if (reachedEnd || !json.cursor) break;
    cursor = json.cursor;
  }
  return out;
}

function pickTimestamp(item: FeedItem): Date {
  const isRepost = item.reason?.$type === "app.bsky.feed.defs#reasonRepost";
  if (isRepost) {
    return new Date(item.post.indexedAt);
  }
  return new Date(item.post.record.createdAt ?? item.post.indexedAt);
}

function analyzeItem(
  item: FeedItem,
  actor: string,
  createdAt: Date,
): AnalyzedPost | null {
  const isRepost = item.reason?.$type === "app.bsky.feed.defs#reasonRepost";
  if (isRepost) {
    const by = item.reason?.by;
    if (!by) return null;
    if (
      by.handle.toLowerCase() !== actor.toLowerCase() &&
      by.did !== actor
    )
      return null;
    return {
      uri: item.post.uri,
      createdAt,
      kind: "repost",
      text: item.post.record.text ?? "",
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
      hashtags: [],
      mentions: [],
    };
  }

  const authorMatches =
    item.post.author.handle.toLowerCase() === actor.toLowerCase() ||
    item.post.author.did === actor;
  if (!authorMatches) return null;

  const record = item.post.record;
  const isReply = !!record.reply;
  const embedType = record.embed?.$type ?? "";
  const isQuote =
    embedType.includes("app.bsky.embed.record") &&
    !embedType.includes("recordWithMedia?");
  const hasQuote =
    embedType === "app.bsky.embed.record" ||
    embedType === "app.bsky.embed.recordWithMedia";

  let kind: PostKind = "original";
  if (isReply) kind = "reply";
  else if (hasQuote) kind = "quote";
  void isQuote;

  const { hashtags, mentions } = extractFacets(record.facets ?? []);

  return {
    uri: item.post.uri,
    createdAt,
    kind,
    text: record.text ?? "",
    likeCount: item.post.likeCount ?? 0,
    repostCount: item.post.repostCount ?? 0,
    replyCount: item.post.replyCount ?? 0,
    quoteCount: item.post.quoteCount ?? 0,
    hashtags,
    mentions,
  };
}

function extractFacets(facets: Facet[]): {
  hashtags: string[];
  mentions: string[];
} {
  const hashtags: string[] = [];
  const mentions: string[] = [];
  for (const f of facets) {
    for (const feat of f.features) {
      if (feat.$type === "app.bsky.richtext.facet#tag" && feat.tag) {
        hashtags.push(feat.tag);
      } else if (
        feat.$type === "app.bsky.richtext.facet#mention" &&
        (feat.handle || feat.did)
      ) {
        mentions.push(feat.handle ?? feat.did ?? "");
      }
    }
  }
  return { hashtags, mentions };
}
