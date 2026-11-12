import { QueryClient, QueryFunction, QueryCache, MutationCache } from "@tanstack/react-query";

const ADMIN_TOKEN_STORAGE_KEY = "uranus-admin-token";
const ADMIN_TOKEN_EVENT = "uranus-admin-token-changed";
const isBrowser = typeof window !== "undefined";

function dispatchAdminTokenEvent() {
  if (!isBrowser) return;
  try {
    window.dispatchEvent(new CustomEvent(ADMIN_TOKEN_EVENT));
  } catch (error) {
    console.warn("Failed to dispatch admin token change event", error);
  }
}

export function getAdminAuthToken(): string | null {
  if (!isBrowser) return null;
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to read admin token from storage", error);
    return null;
  }
}

export function setAdminAuthToken(token: string | null) {
  if (!isBrowser) return;
  try {
    if (token) {
      window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
    dispatchAdminTokenEvent();
  } catch (error) {
    console.warn("Unable to persist admin token to storage", error);
  }
}

export function clearAdminAuthToken() {
  setAdminAuthToken(null);
}

export function subscribeToAdminAuthTokenChanges(callback: () => void): () => void {
  if (!isBrowser) return () => {};

  const handler = () => callback();
  const storageHandler = (event: StorageEvent) => {
    if (event.key === ADMIN_TOKEN_STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener(ADMIN_TOKEN_EVENT, handler);
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(ADMIN_TOKEN_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

function applyAdminAuthHeader(headers: Record<string, string>) {
  const adminToken = getAdminAuthToken();
  if (adminToken) {
    headers["Authorization"] = `Bearer ${adminToken}`;
  }
}

// CSRF token management
let csrfToken: string | null = null;
let tokenPromise: Promise<string> | null = null;

async function getCSRFToken(): Promise<string> {
  if (csrfToken !== null) {
    return csrfToken;
  }
  
  if (tokenPromise) {
    return tokenPromise;
  }
  
  tokenPromise = (async () => {
    try {
      const res = await fetch('/api/csrf-token', {
        credentials: 'include'
      });

      if (!res.ok) {
        if (res.status === 404) {
          csrfToken = '';
          return csrfToken ?? '';
        }

        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const data = await res.json();
      csrfToken = typeof data?.csrfToken === 'string' ? data.csrfToken : '';
      return csrfToken ?? '';
    } catch (error) {
      console.warn('Failed to fetch CSRF token:', error);
      csrfToken = '';
      return csrfToken ?? '';
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise!;
}

/**
 * Handles 401 authentication errors by clearing user session and redirecting to welcome page.
 * Only redirects if not already on welcome page.
 */
function handle401AuthError() {
  if (!isBrowser) return;
  
  // Clear stored username since session is invalid
  try {
    localStorage.removeItem('quest-to-uranus-username');
  } catch (error) {
    console.warn('Failed to clear username from localStorage:', error);
  }
  
  // Only redirect if not already on welcome page
  const currentPath = window.location.pathname;
  if (currentPath !== '/welcome' && currentPath !== '/') {
    // Use window.location for redirect (works outside React context)
    window.location.href = '/welcome';
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // Handle CSRF token refresh on 403
    if (res.status === 403 && text.includes('csrf')) {
      csrfToken = null;
      tokenPromise = null;
    }

    if (res.status === 401) {
      clearAdminAuthToken();
      // Handle user authentication error (redirect to welcome)
      handle401AuthError();
    }
    
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Get CSRF token for state-changing requests
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  applyAdminAuthHeader(headers);
  
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    try {
      const token = await getCSRFToken();
      if (token) {
        headers['X-CSRF-Token'] = token;
      }
    } catch (error) {
      console.warn('Failed to get CSRF token for request:', error);
    }
  }
  
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

function buildUrlFromQueryKey(queryKey: readonly unknown[]): string {
  if (!Array.isArray(queryKey)) {
    const path = String(queryKey ?? "");
    return path.startsWith("/") ? path : `/${path}`;
  }

  const parts = [...queryKey];
  let search = "";

  const last = parts[parts.length - 1];
  if (last && typeof last === "object" && !Array.isArray(last)) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(last as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      const value = typeof v === "string" ? v : String(v);
      if (value === "") continue;
      params.set(k, value);
    }
    const qs = params.toString();
    if (qs) search = `?${qs}`;
    parts.pop();
  }

  // Normalize all path segments, strip slashes, and join
  const segments = parts
    .map((p) => String(p))
    .flatMap((p) => p.split("/"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const path = `/${segments.join("/")}`;
  return `${path}${search}`;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const headers: Record<string, string> = {};
    applyAdminAuthHeader(headers);

    const url = buildUrlFromQueryKey(queryKey);
    const res = await fetch(url, {
      credentials: "include",
      headers: Object.keys(headers).length ? headers : undefined,
      signal,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Create query cache with global error handling
const queryCache = new QueryCache({
  onError: (error) => {
    // Handle 401 errors globally for queries
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.startsWith('401:')) {
      handle401AuthError();
    }
  },
});

// Create mutation cache with global error handling
const mutationCache = new MutationCache({
  onError: (error) => {
    // Handle 401 errors globally for mutations
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.startsWith('401:')) {
      handle401AuthError();
    }
  },
});

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Shared query options for reference data endpoints.
 * These options ensure reference data is fetched once at app startup and never refetched
 * unless explicitly invalidated (e.g., when references are published/activated).
 */
export const REFERENCE_DATA_QUERY_OPTIONS = {
  staleTime: Infinity,
  gcTime: Infinity, // Keep in cache forever (formerly cacheTime)
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false,
} as const;
