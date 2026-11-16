import { describe, expect, it } from "vitest";
import { fullName } from "./wowApi";

const sum = (name: string, surname?: string) => ({ ru: { name, surname } , en: { name, surname } }) as never;

describe("Forever names", () => {
  it("joins the surname from the profile", () => expect(fullName({ name: "x", summary: sum("Asavar", "Kul") }, "ru")).toBe("Asavar Kul"));
  it("falls back to the lookup slug", () =>
    expect(fullName({ name: "Valthanis", slug: "valthanis-deadrunner", summary: sum("Valthanis") }, "ru")).toBe("Valthanis Deadrunner"));
  it("leaves a single name alone", () => expect(fullName({ name: "Solo", slug: "solo" }, "en")).toBe("Solo"));
});
