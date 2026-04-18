import { useCallback, useEffect, useMemo, useState } from "react";
import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { getOAuthClient, initOAuth } from "./oauth";

export interface SessionState {
  ready: boolean;
  session: OAuthSession | null;
  agent: Agent | null;
  did: string | null;
  error: string | null;
  signIn: (handle: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useSession(): SessionState {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await initOAuth();
        if (cancelled) return;
        if (result?.session) {
          setSession(result.session);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("OAuth init failed", e);
          setError(
            e instanceof Error ? e.message : "認証初期化に失敗しました",
          );
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (handle: string) => {
    const client = await getOAuthClient();
    await client.signIn(handle);
  }, []);

  const signOut = useCallback(async () => {
    if (session) {
      await session.signOut();
      setSession(null);
    }
  }, [session]);

  const agent = useMemo(() => (session ? new Agent(session) : null), [session]);
  const did = session?.did ?? null;

  return { ready, session, agent, did, error, signIn, signOut };
}
