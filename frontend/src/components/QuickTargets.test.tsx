import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../i18n";
import en from "../i18n/en.json";
import tr from "../i18n/tr.json";
import { QUICK_TARGETS } from "../lib/quickTargets";
import QuickTargets from "./QuickTargets";

afterEach(cleanup);

describe("Hızlı hedefler", () => {
  it("shows the eight targets with a note and runs the normal search with the query text", () => {
    const onSearch = vi.fn();
    render(<QuickTargets onSearch={onSearch} />);
    const nav = screen.getByRole("navigation", { name: tr.quick.title });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons).toHaveLength(8);
    expect(buttons[0].textContent).toContain(tr.quick.items.barnard.label);
    expect(buttons[0].textContent).toContain(tr.quick.items.barnard.note);
    fireEvent.click(buttons[0]);
    expect(onSearch).toHaveBeenCalledWith("Barnard's Star");
    fireEvent.click(within(nav).getByRole("button", { name: /Orion Bulutsusu \(M42\)/ }));
    expect(onSearch).toHaveBeenLastCalledWith("M42");
  });

  it("every target has a label and a note in both languages, and the row wraps on narrow screens", () => {
    for (const { key } of QUICK_TARGETS) {
      for (const lang of [tr, en]) {
        const item = (lang.quick.items as Record<string, { label: string; note: string }>)[key];
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.note.length).toBeGreaterThan(0);
      }
    }
    render(<QuickTargets onSearch={() => {}} />);
    expect(screen.getByRole("list").className).toContain("flex-wrap");
  });
});
