import { env } from "@/lib/env";

const BACKEND_FETCH_TIMEOUT_MS = 15000;
const BACKEND_FETCH_RETRY_DELAY_MS = 350;
const BACKEND_FETCH_MAX_ATTEMPTS = 2;

function normalizeHeaders(headers?: HeadersInit) {
  if (!headers) {
    return {} as Record<string, string>;
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function isBodyInitPresent(init?: RequestInit) {
  return typeof init?.body !== "undefined";
}

function shouldRetryRequest(method: string, attempt: number) {
  return method === "GET" && attempt < BACKEND_FETCH_MAX_ATTEMPTS;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function backendFetch<T>(
  path: string,
  accessToken?: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();

  for (let attempt = 1; attempt <= BACKEND_FETCH_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), BACKEND_FETCH_TIMEOUT_MS);

    const headers: Record<string, string> = {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...normalizeHeaders(init?.headers),
    };
    if (isBodyInitPresent(init) && !("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(`${env.apiBaseUrl}${path}`, {
        ...init,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      window.clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        if (shouldRetryRequest(method, attempt)) {
          await wait(BACKEND_FETCH_RETRY_DELAY_MS);
          continue;
        }
        throw new Error("El backend no respondio a tiempo.");
      }
      if (shouldRetryRequest(method, attempt)) {
        await wait(BACKEND_FETCH_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Backend request failed");
    }

    return response.json() as Promise<T>;
  }

  throw new Error("Backend request failed");
}
