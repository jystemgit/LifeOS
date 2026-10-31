import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider, LocalizedDate, LocalizedNumber, LocalizedText } from "./language-provider";

describe("locale-aware presentation", () => {
  it("renders translated text in the initial HTML", () => {
    expect(renderToStaticMarkup(
      <LanguageProvider locale="it"><LocalizedText>Ingresar a LIFE OS</LocalizedText></LanguageProvider>,
    )).toBe("Accedi a LIFE OS");
  });

  it("localizes date presentation without shifting the calendar date", () => {
    expect(renderToStaticMarkup(
      <LanguageProvider locale="en"><LocalizedDate value="2026-10-30" /></LanguageProvider>,
    )).toBe("October 30, 2026");
    expect(renderToStaticMarkup(
      <LanguageProvider locale="fr"><LocalizedDate value={new Date("2026-10-30T00:00:00.000Z")} /></LanguageProvider>,
    )).toBe("30 octobre 2026");
  });

  it("uses the chosen language's number formatting", () => {
    expect(renderToStaticMarkup(
      <LanguageProvider locale="it"><LocalizedNumber value={12345.5} /></LanguageProvider>,
    )).toBe("12.345,5");
  });
});
