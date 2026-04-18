import { BrowserOAuthClient } from "@atproto/oauth-client-browser";

function buildClientId(): string {
  const origin = window.location.origin;
  const isDev =
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1");

  if (isDev) {
    // AT Proto loopback 仕様:
    //   - client_id は "http://localhost?..." 固定
    //   - redirect_uri はループバックIP (127.0.0.1 or [::1]) 必須
    // なので localhost アクセス時は 127.0.0.1 に置換して redirect_uri にする
    const loopbackOrigin = origin.replace(
      /^http:\/\/localhost(:|$)/,
      "http://127.0.0.1$1",
    );
    const params = new URLSearchParams({
      redirect_uri: loopbackOrigin + "/",
      scope: "atproto transition:generic",
    });
    return `http://localhost?${params.toString()}`;
  }
  const base = import.meta.env.BASE_URL || "/";
  return `${origin}${base}client-metadata.json`;
}

let clientPromise: Promise<BrowserOAuthClient> | null = null;

export function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (!clientPromise) {
    clientPromise = BrowserOAuthClient.load({
      clientId: buildClientId(),
      handleResolver: "https://bsky.social",
    });
  }
  return clientPromise;
}

type InitResult = Awaited<ReturnType<BrowserOAuthClient["init"]>>;

let initPromise: Promise<InitResult> | null = null;

export function initOAuth(): Promise<InitResult> {
  if (!initPromise) {
    initPromise = getOAuthClient().then((c) => c.init());
  }
  return initPromise;
}
