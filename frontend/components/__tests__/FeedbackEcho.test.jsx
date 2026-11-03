import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeedbackEcho from "../FeedbackEcho.jsx";

let ratio = 0;
let callbacks = [];
beforeEach(() => {
  ratio = 0;
  callbacks = [];
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; callbacks.push(this); }
    observe(target) { queueMicrotask(() => this.cb([{ target, intersectionRatio: ratio }])); }
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => { delete globalThis.IntersectionObserver; });

function Harness({ show, role = "alert", text = "Could not save." }) {
  return <div><FeedbackEcho /><button>Go</button><div id="far">{show && <div role={role}>{text}</div>}</div></div>;
}

describe("FeedbackEcho", () => {
  it("shows an off-screen result after a click as a fixed notice and can be dismissed", async () => {
    const { rerender } = render(<Harness show={false} />);
    fireEvent.click(screen.getByText("Go"));
    rerender(<Harness show />);
    expect(await screen.findByLabelText("Dismiss message")).toBeInTheDocument();
    expect(screen.getAllByText("Could not save.")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Dismiss message"));
    expect(screen.getAllByText("Could not save.")).toHaveLength(1);
  });

  it("stays quiet when the result is already on screen", async () => {
    ratio = 1;
    const { rerender } = render(<Harness show={false} />);
    fireEvent.click(screen.getByText("Go"));
    rerender(<Harness show />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByLabelText("Dismiss message")).toBeNull();
  });

  it("ignores results that did not follow a user action, and loading text", async () => {
    const { rerender } = render(<Harness show={false} />);
    rerender(<Harness show />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByLabelText("Dismiss message")).toBeNull();
    fireEvent.click(screen.getByText("Go"));
    rerender(<Harness show={false} />);
    rerender(<Harness show role="status" text="Loading…" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByLabelText("Dismiss message")).toBeNull();
  });
});
