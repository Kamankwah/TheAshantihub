import { fireEvent, render, screen } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";

import { ForgotPasswordLink, FORGOT_PASSWORD_URL } from "../src/ui/ForgotPasswordLink";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: "opened" })) }));

test("opens the web reset form", async () => {
  await render(<ForgotPasswordLink />);
  fireEvent.press(screen.getByText("Forgot password?"));
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(FORGOT_PASSWORD_URL);
  expect(FORGOT_PASSWORD_URL).toMatch(/\/\?auth=forgot$/);
});
