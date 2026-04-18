import type { Agent } from "@atproto/api";
import type { Summary } from "./analyze";
import type { Engager, NewFollow } from "./bsky";

export const RECAP_COLLECTION = "jp.hirohero.skyhighlights.monthly";

export interface RecapRecord {
  $type: string;
  month: string;
  monthLabel: string;
  posts: number;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  newFollowsCount: number;
  heatmap: number[][];
  heatmapMax: number;
  topEngagers: Array<{
    did: string;
    handleSnapshot: string;
    displayNameSnapshot?: string;
    avatarSnapshot?: string;
    likes: number;
    reposts: number;
  }>;
  newFollows: Array<{
    did: string;
    handleSnapshot: string;
    displayNameSnapshot?: string;
    avatarSnapshot?: string;
    followedAt: string;
  }>;
  mostLikedUri?: string;
  mostLikedText?: string;
  mostLikedLikes?: number;
  createdAt: string;
}

export interface SaveRecapArgs {
  agent: Agent;
  did: string;
  monthStart: Date;
  monthLabel: string;
  summary: Summary;
  engagers: Engager[];
  newFollows: NewFollow[];
}

function monthRkey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function saveRecap({
  agent,
  did,
  monthStart,
  monthLabel,
  summary,
  engagers,
  newFollows,
}: SaveRecapArgs): Promise<string> {
  const rkey = monthRkey(monthStart);
  const record: RecapRecord = {
    $type: RECAP_COLLECTION,
    month: monthStart.toISOString(),
    monthLabel,
    posts: summary.total,
    likes: summary.totalLikes,
    reposts: summary.totalReposts,
    replies: summary.totalReplies,
    quotes: summary.totalQuotes,
    newFollowsCount: newFollows.length,
    heatmap: summary.heatmap,
    heatmapMax: summary.heatmapMax,
    topEngagers: engagers.slice(0, 10).map((e) => ({
      did: e.did,
      handleSnapshot: e.handle,
      displayNameSnapshot: e.displayName,
      avatarSnapshot: e.avatar,
      likes: e.likes,
      reposts: e.reposts,
    })),
    newFollows: newFollows.slice(0, 20).map((f) => ({
      did: f.did,
      handleSnapshot: f.handle,
      displayNameSnapshot: f.displayName,
      avatarSnapshot: f.avatar,
      followedAt: f.followedAt.toISOString(),
    })),
    mostLikedUri: summary.mostLiked?.uri,
    mostLikedText: summary.mostLiked?.text,
    mostLikedLikes: summary.mostLiked?.likeCount,
    createdAt: new Date().toISOString(),
  };

  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: RECAP_COLLECTION,
    rkey,
    record: record as unknown as Record<string, unknown>,
  });

  return `at://${did}/${RECAP_COLLECTION}/${rkey}`;
}

export async function loadRecap(
  agent: Agent,
  did: string,
  monthStart: Date,
): Promise<RecapRecord | null> {
  const rkey = monthRkey(monthStart);
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: RECAP_COLLECTION,
      rkey,
    });
    return res.data.value as unknown as RecapRecord;
  } catch {
    return null;
  }
}
