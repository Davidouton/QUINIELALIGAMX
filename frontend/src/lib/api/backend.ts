import { env } from "@/lib/env";

const BACKEND_FETCH_GET_TIMEOUT_MS = 15000;
const BACKEND_FETCH_MUTATION_TIMEOUT_MS = 60000;
const BACKEND_FETCH_RETRY_DELAY_MS = 350;
const BACKEND_FETCH_MAX_ATTEMPTS = 2;
const LOCAL_BACKEND_PATTERN = /(^https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i;

type BackendFetchInit = RequestInit & {
  timeoutMs?: number;
};

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
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function getErrorMessage(errorText: string) {
  if (!errorText) return "Backend request failed";
  try {
    const parsed = JSON.parse(errorText) as { detail?: unknown };
    if (typeof parsed.detail === "string") {
      return parsed.detail;
    }
  } catch {
    // Keep the raw backend text when it is not JSON.
  }
  return errorText;
}

function isFrontendRunningLocally() {
  if (typeof window === "undefined") return true;
  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
}

function isBackendMisconfiguredForDeployedFrontend() {
  return !isFrontendRunningLocally() && LOCAL_BACKEND_PATTERN.test(env.apiBaseUrl);
}

export async function backendFetch<T>(
  path: string,
  accessToken?: string,
  init?: BackendFetchInit,
): Promise<T> {
  if (isBackendMisconfiguredForDeployedFrontend()) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL sigue apuntando a localhost. Configura la URL publica del backend y vuelve a desplegar el frontend.",
    );
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const { timeoutMs: requestTimeoutMs, signal: requestSignal, ...requestInit } = init ?? {};
  const timeoutMs =
    requestTimeoutMs ?? (method === "GET" ? BACKEND_FETCH_GET_TIMEOUT_MS : BACKEND_FETCH_MUTATION_TIMEOUT_MS);

  for (let attempt = 1; attempt <= BACKEND_FETCH_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (requestSignal) {
      if (requestSignal.aborted) {
        controller.abort();
      } else {
        requestSignal.addEventListener("abort", abortFromCaller, { once: true });
      }
    }

    const headers: Record<string, string> = {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...normalizeHeaders(requestInit.headers),
    };
    if (isBodyInitPresent(requestInit) && !("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(`${env.apiBaseUrl}${path}`, {
        ...requestInit,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      globalThis.clearTimeout(timeoutId);
      requestSignal?.removeEventListener("abort", abortFromCaller);
      if (error instanceof Error && error.name === "AbortError") {
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
      globalThis.clearTimeout(timeoutId);
      requestSignal?.removeEventListener("abort", abortFromCaller);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(getErrorMessage(errorText));
    }

    return response.json() as Promise<T>;
  }

  throw new Error("Backend request failed");
}
