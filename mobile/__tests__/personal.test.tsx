import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Personal from "../src/app/(auth)/register/personal";
import { api } from "../src/lib/api";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const NEEDED = "Enter your email so we can send you a confirmation link.";

beforeEach(() => jest.clearAllMocks());

async function fill(email: string) {
  await render(<Personal />);
  await fireEvent.changeText(screen.getByLabelText("First name"), "Abena");
  await fireEvent.changeText(screen.getByLabelText("Last name"), "Mensah");
  await fireEvent.changeText(screen.getByLabelText("Mobile number"), "0207886600");
  await fireEvent.changeText(screen.getByLabelText("Email"), email);
  await fireEvent.changeText(screen.getByLabelText("Password"), "s3cret-pass");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
}

describe("business owner sign-up form", () => {
  it.each(["", "   ", "abena", "abena@example", "abena@.com", "a b@example.com"])("blocks_%p_with_no_request", async (email) => {
    await fill(email);
    expect(await screen.findByText(NEEDED)).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("sends_the_trimmed_email", async () => {
    apiMock.mockResolvedValue({ challenge_id: "c", masked_destination: "+233***00", channel: "sms" });
    await fill("  abena@example.com ");
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0][1].body.email).toBe("abena@example.com");
    expect(screen.queryByText(NEEDED)).toBeNull();
  });
});
