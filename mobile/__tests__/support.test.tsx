import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import InboxScreen from "../src/app/inbox";
import NotificationsScreen from "../src/app/notifications";
import SupportChat from "../src/app/support/[id]";
import NewSupport from "../src/app/support/new";
import { sourceFor } from "../src/features/support/api";
import { useSeen } from "../src/features/support/seen";
import { api, ApiError } from "../src/lib/api";
import { useAuth } from "../src/state/auth";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));
const mockStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");

const convo = (over: Record<string, unknown> = {}) => ({
  id: 9, subject: "Hand-woven kente stole", status: "open", updated_at: "2026-11-07T10:00:00Z",
  messages: [
    { id: 1, sender_type: "customer", body: "Is this still in stock?", created_at: "2026-11-07T09:00:00Z" },
    { id: 2, sender_type: "staff", body: "Yes, we checked for you.", created_at: "2026-11-07T10:00:00Z" },
  ],
  ...over,
});

function client(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockParams = {};
  useSeen.setState({ seen: {} });
  useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } });
});

describe("start a support conversation", () => {
  it("contact_support_creates_conversation_with_subject", async () => {
    mockParams = { about: "Hand-woven kente stole", listing: "7" };
    apiMock.mockResolvedValue(convo());
    await render(client(<NewSupport />));
    expect(screen.getByText("AshantiHub Support")).toBeTruthy();
    expect(screen.getByText("Re: Hand-woven kente stole")).toBeTruthy();
    expect(screen.getByLabelText("Send message").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText("Your message"), "Is this still in stock?");
    await fireEvent.press(screen.getByLabelText("Send message"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/support/[id]", params: { id: "9" } }));
    expect(apiMock).toHaveBeenCalledWith("/api/messaging/conversations/", {
      body: { subject: "Hand-woven kente stole", body: "Is this still in stock?", about_listing: 7, source: "listing_page" },
    });
  });

  it("source_follows_what_the_conversation_is_about", () => {
    expect(sourceFor({ order: "5" }, "customer")).toBe("order_page");
    expect(sourceFor({ listing: "7" }, "customer")).toBe("listing_page");
    expect(sourceFor({}, "customer")).toBe("app");
    expect(sourceFor({}, "business_owner")).toBe("business_dashboard");
  });

  it("a_failed_start_keeps_the_text_and_says_so", async () => {
    mockParams = { about: "Order #5", order: "5" };
    apiMock.mockRejectedValue(new ApiError(500, {}));
    await render(client(<NewSupport />));
    await fireEvent.changeText(screen.getByLabelText("Your message"), "Where is it?");
    await fireEvent.press(screen.getByLabelText("Send message"));
    expect(await screen.findByText(/couldn.t send/i)).toBeTruthy();
    expect(screen.getByLabelText("Your message").props.value).toBe("Where is it?");
  });
});

describe("support chat", () => {
  beforeEach(() => {
    mockParams = { id: "9" };
  });

  it("chat_has_no_business_as_recipient", async () => {
    apiMock.mockResolvedValue([convo()]);
    await render(client(<SupportChat />));
    expect(await screen.findByText("Yes, we checked for you.")).toBeTruthy();
    expect(screen.getByRole("header", { name: "AshantiHub Support" })).toBeTruthy();
    expect(screen.getByText("Re: Hand-woven kente stole")).toBeTruthy();
    expect(screen.queryByText(/message the seller|chat with the seller|message the business/i)).toBeNull();
    expect(screen.queryByText(/whatsapp|phone/i)).toBeNull();
  });

  it("your_messages_and_support_replies_are_labelled", async () => {
    apiMock.mockResolvedValue([convo()]);
    await render(client(<SupportChat />));
    await screen.findByText("Yes, we checked for you.");
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getAllByText("AshantiHub Support").length).toBeGreaterThan(0);
  });

  it("replying_posts_to_the_conversation", async () => {
    apiMock.mockImplementation(async (path: string) => (path === "/api/messaging/conversations/" ? [convo()] : { id: 3 }));
    await render(client(<SupportChat />));
    await fireEvent.changeText(await screen.findByLabelText("Your message"), "Thanks!");
    await fireEvent.press(screen.getByLabelText("Send message"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/messaging/conversations/9/messages/", { body: { body: "Thanks!" } }));
  });

  it("unknown_conversation_offers_inbox", async () => {
    apiMock.mockResolvedValue([]);
    await render(client(<SupportChat />));
    expect(await screen.findByText(/couldn.t find this conversation/i)).toBeTruthy();
  });
});

describe("inbox", () => {
  it("unread_dot_when_support_replied_last_and_clears_after_opening", async () => {
    apiMock.mockResolvedValue([convo()]);
    await render(client(<InboxScreen />));
    const row = await screen.findByLabelText(/Re: Hand-woven kente stole.*unread/i);
    await fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith({ pathname: "/support/[id]", params: { id: "9" } });
    await render(client(<InboxScreen />));
    await waitFor(() => expect(screen.queryByLabelText(/unread/i)).toBeNull());
  });

  it("empty_inbox_says_so", async () => {
    apiMock.mockResolvedValue([]);
    await render(client(<InboxScreen />));
    expect(await screen.findByText(/no messages yet/i)).toBeTruthy();
  });

  it("error_state_offers_retry", async () => {
    apiMock.mockRejectedValue(new ApiError(500, {}));
    await render(client(<InboxScreen />));
    expect(await screen.findByLabelText("Try again")).toBeTruthy();
  });
});

describe("notifications", () => {
  const note = (id: number, read: boolean) => ({ id, kind: "order", title: `Update ${id}`, body: "Your order moved on.", link: "", icon: "", is_read: read, created_at: "2026-11-07T10:00:00Z" });

  it("read_all_clears_unread_count", async () => {
    let unread = 2;
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/notifications/") return { unread_count: unread, results: [note(1, unread === 0), note(2, unread === 0)] };
      if (path === "/api/notifications/read-all/") { unread = 0; return {}; }
      throw new ApiError(404, {});
    });
    await render(client(<NotificationsScreen />));
    expect(await screen.findByText("2 unread")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Mark all as read"));
    expect(await screen.findByText("All caught up")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/notifications/read-all/", { method: "POST" });
  });

  it("tapping_a_notification_marks_it_read", async () => {
    apiMock.mockImplementation(async (path: string) => (path === "/api/notifications/" ? { unread_count: 1, results: [note(1, false)] } : {}));
    await render(client(<NotificationsScreen />));
    await fireEvent.press(await screen.findByLabelText(/Update 1/));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/notifications/1/read/", { method: "POST" }));
  });

  it("empty_notifications_say_so", async () => {
    apiMock.mockResolvedValue({ unread_count: 0, results: [] });
    await render(client(<NotificationsScreen />));
    expect(await screen.findByText(/no notifications yet/i)).toBeTruthy();
  });
});
