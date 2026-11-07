import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary.jsx";

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error("boom");
  return <p>recovered</p>;
}

describe("ErrorBoundary", () => {
  afterEach(() => { shouldThrow = true; vi.restoreAllMocks(); });

  it("shows a message with Try again instead of a blank page, and recovers", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    render(<ErrorBoundary onError={onError}><Bomb /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(onError).toHaveBeenCalledOnce();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("offers only a reload when a chunk could not be loaded", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Stale() { throw new Error("Failed to fetch dynamically imported module: /assets/x.js"); }
    render(<ErrorBoundary><Stale /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("A newer version is available");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
  });

  it("renders its children untouched when nothing fails", () => {
    shouldThrow = false;
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
