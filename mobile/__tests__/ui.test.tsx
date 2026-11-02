import { fireEvent, render, screen } from "@testing-library/react-native";

import { Button } from "../src/ui/Button";
import { Field } from "../src/ui/Field";
import { Pill } from "../src/ui/Pill";
import { Price } from "../src/ui/Price";

describe("ui kit", () => {
  it("Button exposes role button and its label", async () => {
    await render(<Button label="Pay now" onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Pay now" })).toBeTruthy();
  });

  it("a disabled Button ignores presses", async () => {
    const onPress = jest.fn();
    await render(<Button label="Pay now" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole("button", { name: "Pay now" }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("a loading Button ignores presses too", async () => {
    const onPress = jest.fn();
    await render(<Button label="Pay now" onPress={onPress} loading />);
    await fireEvent.press(screen.getByRole("button", { name: "Pay now" }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("Field shows its label and the error under it", async () => {
    await render(<Field label="Phone number" error="Enter a valid number" />);
    expect(screen.getByText("Phone number")).toBeTruthy();
    expect(screen.getByText("Enter a valid number")).toBeTruthy();
    expect(screen.getByLabelText("Phone number")).toBeTruthy();
  });

  it("Price formats cedis with two decimals", async () => {
    await render(<Price amount={1234.5} />);
    expect(screen.getByText("GH₵ 1,234.50")).toBeTruthy();
  });

  it("Price accepts the API's string amounts", async () => {
    await render(<Price amount="450.00" />);
    expect(screen.getByText("GH₵ 450.00")).toBeTruthy();
  });

  it("Pill always renders its text, not just a colour", async () => {
    await render(<Pill tone="warn" icon="clock" label="Needs action" />);
    expect(screen.getByText("Needs action")).toBeTruthy();
  });
});
