import { api, ApiError } from "../src/lib/api";
import { session } from "../src/lib/session";
import { useAuth } from "../src/state/auth";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

type Reply = { status: number; body?: unknown };
function reply({ status, body }: Reply) {
  const text = body === undefined ? "" : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}
function mockFetch(...replies: Reply[]) {
  const fn = jest.fn(async () => reply(replies.shift() ?? { status: 500 }));
  (globalThis as any).fetch = fn;
  return fn;
}
const urlOf = (call: unknown[]) => String(call[0]);
const headersOf = (call: unknown[]) => ((call[1] as RequestInit).headers ?? {}) as Record<string, string>;

beforeEach(async () => {
  await session.clear();
  useAuth.setState({ status: "signedOut", account: undefined });
});

describe("api client", () => {
  it("adds_bearer_and_mobile_header", async () => {
    await session.save("access-1", "refresh-1");
    const fetchMock = mockFetch({ status: 200, body: { ok: true } });
    await expect(api("/api/accounts/me/")).resolves.toEqual({ ok: true });
    const headers = headersOf(fetchMock.mock.calls[0]);
    expect(headers.Authorization).toBe("Bearer access-1");
    expect(headers["X-Client"]).toBe("mobile");
  });

  it("retries_once_after_401_with_new_token", async () => {
    await session.save("old", "refresh-1");
    const fetchMock = mockFetch(
      { status: 401 },
      { status: 200, body: { token: "new", refresh_token: "refresh-2" } },
      { status: 200, body: { data: 1 } },
    );
    await expect(api("/api/orders/")).resolves.toEqual({ data: 1 });
    expect(urlOf(fetchMock.mock.calls[1])).toContain("/api/accounts/session/refresh/");
    expect(headersOf(fetchMock.mock.calls[2]).Authorization).toBe("Bearer new");
    expect((await session.load()).refresh).toBe("refresh-2");
  });

  it("concurrent_401s_trigger_one_refresh", async () => {
    await session.save("old", "refresh-1");
    let refreshes = 0;
    (globalThis as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes("/session/refresh/")) {
        refreshes += 1;
        return reply({ status: 200, body: { token: "new", refresh_token: "refresh-2" } });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer new" ? reply({ status: 200, body: { ok: 1 } }) : reply({ status: 401 });
    });
    await Promise.all([api("/api/a/"), api("/api/b/")]);
    expect(refreshes).toBe(1);
  });

  it("refresh_failure_signs_out", async () => {
    await session.save("old", "refresh-1");
    useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } });
    mockFetch({ status: 401 }, { status: 401 }, { status: 204 });
    await expect(api("/api/orders/")).rejects.toMatchObject({ status: 401 });
    expect(useAuth.getState().status).toBe("signedOut");
    expect((await session.load()).access).toBeUndefined();
  });

  it("staff_account_is_rejected", async () => {
    await expect(
      useAuth.getState().signIn({ token: "t", account_type: "staff", id: 9, full_name: "Staff" }),
    ).rejects.toMatchObject({ code: "staff_not_supported" });
    expect((await session.load()).access).toBeUndefined();
    expect(ApiError).toBeDefined();
  });
});
