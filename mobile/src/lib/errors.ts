import { ApiError } from "./api";

/** A readable message from an API failure: the server's own words when it sent some, else the fallback. */
export function apiMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const body = err.body;
  if (typeof body === "string" && body.trim() && body.length < 300 && !body.trim().startsWith("<")) return body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["detail", "message", "error"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
    for (const value of Object.values(record)) {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}
