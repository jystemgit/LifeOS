import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "./language-provider";
import { DailySchedule } from "./daily-schedule";
import { emptyHours } from "@/domain/hourly-planning";

describe("published hourly schedule", () => {
  it("shows only nonempty hours chronologically without execution controls", () => {
    const hours = emptyHours();
    hours[20] = "Read";
    hours[6] = "Wake up";
    hours[10] = "   ";
    const markup = renderToStaticMarkup(<LanguageProvider locale="en">
      <DailySchedule plan={{ date: "2026-10-30", hours }} date="2026-10-30" />
    </LanguageProvider>);
    expect(markup).toContain("Today&#x27;s Plan");
    expect(markup.indexOf("Wake up")).toBeLessThan(markup.indexOf("Read"));
    expect(markup.match(/<li>/g)).toHaveLength(2);
    expect(markup).not.toContain("10:00");
    expect(markup).not.toMatch(/<input|<button|progress|checkbox/);
  });
  it("provides a planning link for absent or empty publications", () => {
    for (const plan of [null, { date: "2026-10-30", hours: emptyHours() }]) {
      const markup = renderToStaticMarkup(<LanguageProvider locale="en">
        <DailySchedule plan={plan} date="2026-10-30" />
      </LanguageProvider>);
      expect(markup).toContain("No activities have been published");
      expect(markup).toContain('/planning/day?date=2026-10-30');
    }
  });
});
