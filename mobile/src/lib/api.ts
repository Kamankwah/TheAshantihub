import { APP_BUILD, APP_VERSION } from "./appVersion";
import { API_BASE } from "./config";
import { session } from "./session";

export class ApiError extends Error {
  status: number;
  code?: string;
  body: unknown;

  constructor(status: number, body: unknown, code?: string) {
    super(code ?? `Request failed (${status})`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export const REQUEST_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 120_000;

type Init = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
};

let onSessionLost: () => void = () => {};
/** The auth store registers here, so the client can sign out without importing it (no import cycle). */
export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler;
}

export type UpgradeNotice = { minVersion?: string; storeUrl?: string };
let onUpgradeRequired: (notice: UpgradeNotice) => void = () => {};
/** The update gate registers here: the server answered 426, so this build is too old to keep working. */
export function setUpgradeHandler(handler: (notice: UpgradeNotice) => void) {
  onUpgradeRequired = handler;
}

function build(path: string, query?: Init["query"]) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function send(path: string, init: Init) {
  const headers: Record<string, string> = { "X-Client": "mobile", "X-App-Version": APP_VERSION, "X-App-Build": APP_BUILD, ...(init.headers ?? {}) };
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (init.auth !== false && session.access) headers.Authorization = `Bearer ${session.access}`;
  // A request that hangs (poor network, dead connection) must end, or the screen waits forever. The rejection is a plain
  // network failure, which the screens already treat as offline. Uploads get longer because photos are large.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), isForm ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  try {
    return await fetch(build(path, init.query), {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parse(res: { status: number; text: () => Promise<string> }) {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Call the AshantiHub API. A 401 triggers one silent refresh and one retry; if that fails the user is signed out. */
export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && init.auth !== false && session.refreshToken) {
    const renewed = await session.refresh();
    if (renewed === "renewed") res = await send(path, init);
    else if (renewed === "ended") onSessionLost();
    // "unavailable": the 401 stays as the answer for this call, and the session is kept for the next one
  }
  const body = await parse(res);
  if (!res.ok) {
    const code = body && typeof body === "object" ? (body as { code?: string }).code : undefined;
    if (res.status === 426 && code === "upgrade_required") {
      const info = body as { min_supported_version?: string; store_url?: string };
      onUpgradeRequired({ minVersion: info.min_supported_version, storeUrl: info.store_url || undefined });
    }
    throw new ApiError(res.status, body, code);
  }
  return body as T;
}
