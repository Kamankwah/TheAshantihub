import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Terms from "../src/app/(auth)/register/terms";
import { api, ApiError } from "../src/lib/api";

jest.mock("expo-router", () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-screen-capture", () => ({ usePreventScreenCapture: jest.fn() }));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});

const apiMock = api as jest.Mock;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderScreen = () =>
  render(
    <QueryClientProvider client={client()}>
      <Terms />
    </QueryClientProvider>,
  );

describe("Business Agreement step (MOB-17)", () => {
  it("shows the text the server sends and lets the owner accept it", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/accounts/business-terms/") return { version: "September 2026", text: "AshantiHub Business Agreement (summary)\n\n1. Listing Accuracy — from the API" };
      if (path.includes("hours")) return { has_hours: false, days: [] };
      return {};
    });
    await renderScreen();
    expect(await screen.findByText(/Listing Accuracy — from the API/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("checkbox", { name: "I accept the Business Agreement" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "I accept the Business Agreement" }).props.accessibilityState.checked).toBe(true));
  });

  it("will not let anyone accept words they could not read", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/accounts/business-terms/") throw new ApiError(500, {});
      if (path.includes("hours")) return { has_hours: false, days: [] };
      return {};
    });
    await renderScreen();
    expect(await screen.findByText(/couldn’t load the Business Agreement/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("checkbox", { name: "I accept the Business Agreement" }));
    expect(screen.getByRole("checkbox", { name: "I accept the Business Agreement" }).props.accessibilityState.checked).toBe(false);
    expect(screen.getByRole("button", { name: "Submit for review" }).props.accessibilityState.disabled).toBe(true);
  });
});
