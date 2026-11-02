import { render, screen } from "@testing-library/react-native";

import Welcome from "../src/app/(auth)/welcome";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

describe("welcome screen", () => {
  it("offers the customer and business doors", async () => {
    await render(<Welcome />);
    expect(screen.getByRole("header", { name: /Akwaaba/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I'm a customer: create account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I'm a customer: sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I own a business" })).toBeTruthy();
  });
});
