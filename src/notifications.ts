import type { Agent } from "@atproto/api";
import type { Engager, NewFollow } from "./bsky";

export interface NotificationAggregation {
  engagers: Engager[];
  likesTotal: number;
  repostsTotal: number;
  repliesTotal: number;
  quotesTotal: number;
  newFollows: NewFollow[];
}

export async function aggregateNotifications(
  agent: Agent,
  startMs: number,
  endMs: number,
): Promise<NotificationAggregation> {
  const map = new Map<string, Engager>();
  const followMap = new Map<string, NewFollow>();

  let likesTotal = 0;
  let repostsTotal = 0;
  let repliesTotal = 0;
  let quotesTotal = 0;

  let cursor: string | undefined;
  const MAX_PAGES = 100;

  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await agent.app.bsky.notification.listNotifications({
      limit: 100,
      cursor,
    });
    if (!res.success) break;

    let stop = false;
    for (const n of res.data.notifications) {
      const tm = new Date(n.indexedAt).getTime();
      if (tm < startMs) {
        stop = true;
        continue;
      }
      if (tm > endMs) continue;

      const actor = n.author;

      switch (n.reason) {
        case "like":
          likesTotal++;
          incrementEngager(map, actor, "likes");
          break;
        case "repost":
          repostsTotal++;
          incrementEngager(map, actor, "reposts");
          break;
        case "reply":
          repliesTotal++;
          break;
        case "quote":
          quotesTotal++;
          break;
        case "follow":
          if (!followMap.has(actor.did)) {
            followMap.set(actor.did, {
              did: actor.did,
              handle: actor.handle,
              displayName: actor.displayName,
              avatar: actor.avatar,
              followedAt: new Date(n.indexedAt),
            });
          }
          break;
      }
    }

    if (stop || !res.data.cursor) break;
    cursor = res.data.cursor;
  }

  const engagers = [...map.values()].sort(
    (a, b) => b.likes + b.reposts - (a.likes + a.reposts),
  );
  const newFollows = [...followMap.values()].sort(
    (a, b) => b.followedAt.getTime() - a.followedAt.getTime(),
  );

  return {
    engagers,
    likesTotal,
    repostsTotal,
    repliesTotal,
    quotesTotal,
    newFollows,
  };
}

function incrementEngager(
  map: Map<string, Engager>,
  actor: {
    did: string;
    handle: string;
    avatar?: string;
    displayName?: string;
  },
  key: "likes" | "reposts",
): void {
  const existing = map.get(actor.did) ?? {
    did: actor.did,
    handle: actor.handle,
    avatar: actor.avatar,
    displayName: actor.displayName,
    likes: 0,
    reposts: 0,
  };
  existing[key]++;
  map.set(actor.did, existing);
}
