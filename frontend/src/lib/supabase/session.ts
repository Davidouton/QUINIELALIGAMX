import { env } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export const NO_ACTIVE_SESSION_MESSAGE = "No hay sesion activa";

type StoredSupabaseSession =
  | {
      access_token?: string;
      currentSession?: {
        access_token?: string;
      } | null;
    }
  | null;

function getSupabaseStorageKeys(): string[] {
  try {
    const url = new URL(env.supabaseUrl);
    const host = url.hostname;
    const projectRef = host.split(".")[0];
    return [
      `sb-${projectRef}-auth-token`,
      `sb-${host}-auth-token`,
    ];
  } catch {
    return [];
  }
}

function readStoredAccessToken(key: string): string | null {
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as StoredSupabaseSession;
    if (parsed?.access_token) {
      return parsed.access_token;
    }
    if (parsed?.currentSession?.access_token) {
      return parsed.currentSession.access_token;
    }
  } catch {
    return null;
  }

  return null;
}

function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  for (const key of getSupabaseStorageKeys()) {
    const token = readStoredAccessToken(key);
    if (token) {
      return token;
    }
  }

  return null;
}

export async function getBrowserAccessToken() {
  const storedAccessToken = getStoredAccessToken();
  if (storedAccessToken) {
    return storedAccessToken;
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error(NO_ACTIVE_SESSION_MESSAGE);
  }

  return session.access_token;
}

export async function getBrowserSession() {
  const storedAccessToken = getStoredAccessToken();
  if (storedAccessToken) {
    return { access_token: storedAccessToken };
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
}
