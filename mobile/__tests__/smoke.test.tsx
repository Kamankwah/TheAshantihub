import { render, screen } from "@testing-library/react-native";

import Index from "../src/app/index";

describe("app shell", () => {
  it("renders the AshantiHub name", async () => {
    await render(<Index />);
    expect(screen.getByText("AshantiHub")).toBeTruthy();
  });
});
