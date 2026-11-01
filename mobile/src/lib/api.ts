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

type Init = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
};

let onSessionLost: () => void = () => {};
/** The auth store registers here, so the client can sign out without importing it (no import cycle). */
export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler;
}

function build(path: string, query?: Init["query"]) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function send(path: string, init: Init) {
  const headers: Record<string, string> = { "X-Client": "mobile" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.auth !== false && session.access) headers.Authorization = `Bearer ${session.access}`;
  return fetch(build(path, init.query), {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
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
    if (await session.refresh()) res = await send(path, init);
    else onSessionLost();
  }
  const body = await parse(res);
  if (!res.ok) {
    const code = body && typeof body === "object" ? (body as { code?: string }).code : undefined;
    throw new ApiError(res.status, body, code);
  }
  return body as T;
}
