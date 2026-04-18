import { useEffect, useRef, useState } from "react";
import { RECAP_COLLECTION } from "./recap-record";

const JETSTREAM_URL = "wss://jetstream2.us-east.bsky.network/subscribe";

export interface RecapEvent {
  did: string;
  rkey: string;
  timeMs: number;
  record?: {
    monthLabel?: string;
    posts?: number;
    likes?: number;
    reposts?: number;
  };
}

export interface ResolvedRecap extends RecapEvent {
  handle: string;
  displayName?: string;
  avatar?: string;
}

interface JetstreamMessage {
  did: string;
  time_us: number;
  kind: string;
  commit?: {
    operation: string;
    collection: string;
    rkey: string;
    record?: unknown;
  };
}

export function useRecentRecaps(enabled: boolean): RecapEvent[] {
  const [events, setEvents] = useState<RecapEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const url =
      `${JETSTREAM_URL}?wantedCollections=${encodeURIComponent(RECAP_COLLECTION)}`;
    let closed = false;
    let ws: WebSocket;

    function connect() {
      if (closed) return;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data) as JetstreamMessage;
          if (msg.kind !== "commit" || !msg.commit) return;
          if (msg.commit.operation !== "create" && msg.commit.operation !== "update") return;
          if (msg.commit.collection !== RECAP_COLLECTION) return;

          const evt: RecapEvent = {
            did: msg.did,
            rkey: msg.commit.rkey,
            timeMs: Math.floor(msg.time_us / 1000),
            record: msg.commit.record as RecapEvent["record"],
          };
          setEvents((prev) => {
            const key = `${evt.did}:${evt.rkey}`;
            const filtered = prev.filter(
              (e) => `${e.did}:${e.rkey}` !== key,
            );
            return [evt, ...filtered].slice(0, 20);
          });
        } catch {
          // ignore malformed
        }
      });

      ws.addEventListener("close", () => {
        if (closed) return;
        // 切断時は 3 秒後に再接続
        setTimeout(connect, 3000);
      });

      ws.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      });
    }

    connect();

    return () => {
      closed = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled]);

  return events;
}

export async function resolveRecapProfiles(
  events: RecapEvent[],
): Promise<ResolvedRecap[]> {
  if (events.length === 0) return [];
  const dids = [...new Set(events.map((e) => e.did))];
  const profilesByDid = new Map<
    string,
    { handle: string; displayName?: string; avatar?: string }
  >();

  for (let i = 0; i < dids.length; i += 25) {
    const batch = dids.slice(i, i + 25);
    const params = batch
      .map((d) => `actors=${encodeURIComponent(d)}`)
      .join("&");
    try {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${params}`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        profiles?: Array<{
          did: string;
          handle: string;
          displayName?: string;
          avatar?: string;
        }>;
      };
      for (const p of json.profiles ?? []) {
        profilesByDid.set(p.did, {
          handle: p.handle,
          displayName: p.displayName,
          avatar: p.avatar,
        });
      }
    } catch {
      // skip batch
    }
  }

  return events
    .map((e) => {
      const p = profilesByDid.get(e.did);
      if (!p) return null;
      return { ...e, ...p };
    })
    .filter((x): x is ResolvedRecap => x !== null);
}
