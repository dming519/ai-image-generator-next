import type { AuthProvider, AuthUser } from "../../src/lib/types";

const SESSION_COOKIE = "imggen_session";
const STATE_COOKIE = "imggen_oauth_state";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;

interface AuthEnv {
  AUTH_SECRET?: string;
  AUTH_GITHUB_ID?: string;
  AUTH_GITHUB_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
}

interface SessionPayload {
  user: AuthUser;
  expiresAt: number;
}

interface StatePayload {
  provider: AuthProvider;
  state: string;
  redirectTo: string;
  expiresAt: number;
}

function base64UrlEncode(input: Uint8Array | string) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function signValue(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

async function encodeSignedPayload(payload: object, secret: string) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await signValue(body, secret);
  return `${body}.${signature}`;
}

async function decodeSignedPayload<T>(value: string, secret: string) {
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = await signValue(body, secret);
  if (expected !== signature) return null;

  try {
    const text = new TextDecoder().decode(base64UrlDecode(body));
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseCookieHeader(header: string | null) {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

function createCookie(name: string, value: string, maxAge: number) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function clearCookie(name: string) {
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

function resolveRedirectPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function getOrigin(request: Request) {
  return new URL(request.url).origin;
}

function getCallbackUrl(request: Request, provider: AuthProvider) {
  return `${getOrigin(request)}/api/auth/callback/${provider}`;
}

function getAuthSecret(env: AuthEnv) {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("服务端未配置 AUTH_SECRET");
  }
  return secret;
}

function getGithubClient(env: AuthEnv) {
  const clientId = env.AUTH_GITHUB_ID?.trim();
  const clientSecret = env.AUTH_GITHUB_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("服务端未配置 AUTH_GITHUB_ID / AUTH_GITHUB_SECRET");
  }
  return { clientId, clientSecret };
}

function getGoogleClient(env: AuthEnv) {
  const clientId = env.AUTH_GOOGLE_ID?.trim();
  const clientSecret = env.AUTH_GOOGLE_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("服务端未配置 AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET");
  }
  return { clientId, clientSecret };
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });
}

function redirect(url: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: url,
    "Cache-Control": "no-store",
  });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, {
    status: 302,
    headers,
  });
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const text = await response.text();
  let payload: T | null = null;

  try {
    payload = text ? (JSON.parse(text) as T) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(text.slice(0, 300) || `HTTP ${response.status}`);
  }

  if (!payload) {
    throw new Error("OAuth 上游返回了空响应");
  }

  return payload;
}

export async function getSessionFromRequest(request: Request, env: AuthEnv) {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) return null;

  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const raw = cookies.get(SESSION_COOKIE);
  if (!raw) return null;

  const session = await decodeSignedPayload<SessionPayload>(raw, secret);
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }

  return session;
}

export async function requireSession(request: Request, env: AuthEnv) {
  return getSessionFromRequest(request, env);
}

export async function handleSessionRequest(request: Request, env: AuthEnv) {
  const session = await getSessionFromRequest(request, env);
  return json({
    authenticated: !!session,
    user: session?.user ?? null,
  });
}

export async function handleLoginRequest(
  request: Request,
  env: AuthEnv,
  provider: AuthProvider,
) {
  const secret = getAuthSecret(env);
  const redirectTo = resolveRedirectPath(
    new URL(request.url).searchParams.get("redirectTo"),
  );
  const state = crypto.randomUUID();
  const statePayload: StatePayload = {
    provider,
    state,
    redirectTo,
    expiresAt: Date.now() + STATE_TTL_SECONDS * 1000,
  };
  const stateCookie = createCookie(
    STATE_COOKIE,
    await encodeSignedPayload(statePayload, secret),
    STATE_TTL_SECONDS,
  );

  let authorizationUrl: string;
  if (provider === "github") {
    const { clientId } = getGithubClient(env);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", getCallbackUrl(request, provider));
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    authorizationUrl = url.toString();
  } else {
    const { clientId } = getGoogleClient(env);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", getCallbackUrl(request, provider));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    authorizationUrl = url.toString();
  }

  return redirect(authorizationUrl, [stateCookie]);
}

async function resolveGithubUser(env: AuthEnv, request: Request, code: string) {
  const { clientId, clientSecret } = getGithubClient(env);
  const token = await fetchJson<{ access_token?: string }>(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: getCallbackUrl(request, "github"),
      }),
    },
  );

  if (!token.access_token) {
    throw new Error("GitHub 未返回 access token");
  }

  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    Accept: "application/json",
    "User-Agent": "ai-image-generator-next",
  };

  const profile = await fetchJson<{
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  }>("https://api.github.com/user", { headers });

  let email = profile.email;
  if (!email) {
    const emails = await fetchJson<
      Array<{ email: string; primary: boolean; verified: boolean }>
    >("https://api.github.com/user/emails", { headers });
    const primary = emails.find((item) => item.primary && item.verified);
    email = primary?.email ?? emails.find((item) => item.verified)?.email ?? null;
  }

  return {
    provider: "github",
    id: String(profile.id),
    name: profile.name || profile.login,
    email,
    image: profile.avatar_url,
  } satisfies AuthUser;
}

async function resolveGoogleUser(env: AuthEnv, request: Request, code: string) {
  const { clientId, clientSecret } = getGoogleClient(env);
  const tokenResponse = await fetchJson<{ access_token?: string }>(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: getCallbackUrl(request, "google"),
      }).toString(),
    },
  );

  if (!tokenResponse.access_token) {
    throw new Error("Google 未返回 access token");
  }

  const profile = await fetchJson<{
    sub: string;
    name?: string;
    email?: string;
    picture?: string;
  }>("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${tokenResponse.access_token}`,
    },
  });

  return {
    provider: "google",
    id: profile.sub,
    name: profile.name || profile.email || "Google User",
    email: profile.email ?? null,
    image: profile.picture ?? null,
  } satisfies AuthUser;
}

export async function handleCallbackRequest(
  request: Request,
  env: AuthEnv,
  provider: AuthProvider,
) {
  try {
    const secret = getAuthSecret(env);
    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    const oauthError = url.searchParams.get("error")?.trim();

    const cookies = parseCookieHeader(request.headers.get("Cookie"));
    const rawState = cookies.get(STATE_COOKIE);
    const statePayload = rawState
      ? await decodeSignedPayload<StatePayload>(rawState, secret)
      : null;

    if (oauthError) {
      return redirect(`/?authError=${encodeURIComponent(oauthError)}`, [
        clearCookie(STATE_COOKIE),
      ]);
    }

    if (
      !code ||
      !state ||
      !statePayload ||
      statePayload.expiresAt <= Date.now() ||
      statePayload.provider !== provider ||
      statePayload.state !== state
    ) {
      return redirect("/?authError=invalid_state", [clearCookie(STATE_COOKIE)]);
    }

    const user =
      provider === "github"
        ? await resolveGithubUser(env, request, code)
        : await resolveGoogleUser(env, request, code);

    const sessionPayload: SessionPayload = {
      user,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    };

    const sessionCookie = createCookie(
      SESSION_COOKIE,
      await encodeSignedPayload(sessionPayload, secret),
      SESSION_TTL_SECONDS,
    );

    return redirect(statePayload.redirectTo, [
      sessionCookie,
      clearCookie(STATE_COOKIE),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirect(`/?authError=${encodeURIComponent(message.slice(0, 120))}`, [
      clearCookie(STATE_COOKIE),
    ]);
  }
}

export function handleLogoutRequest(request: Request) {
  const redirectTo = resolveRedirectPath(
    new URL(request.url).searchParams.get("redirectTo"),
  );
  return redirect(redirectTo, [clearCookie(SESSION_COOKIE), clearCookie(STATE_COOKIE)]);
}
