import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "./language-provider";
import { DailyPlanner } from "./daily-planner";
import { emptyHours } from "@/domain/hourly-planning";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/planning/day/actions", () => ({ publishDailyPlan: vi.fn() }));

describe("minimal hourly planner", () => {
  it("renders exactly 24 editable hourly fields, a date and one publishing button", () => {
    const hours = emptyHours();
    hours[8] = "Existing publication";
    const markup = renderToStaticMarkup(<LanguageProvider locale="en">
      <DailyPlanner initial={{ date: "2026-10-30", hours }} />
    </LanguageProvider>);
    expect(markup.match(/type="text"/g)).toHaveLength(24);
    expect(markup.match(/type="date"/g)).toHaveLength(1);
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('value="Existing publication"');
    expect(markup).toContain("00:00");
    expect(markup).toContain("23:00");
    expect(markup).not.toContain("required");
    expect(markup).not.toContain("checkbox");
    expect(markup).toContain("Plan My Day");
  });
});
