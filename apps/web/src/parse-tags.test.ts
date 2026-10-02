import { describe, expect, it } from "vitest";
import { parseTags } from "./parse-tags";

describe("parseTags", () => {
  it("splits on commas, trims, lowercases, and dedupes", () => {
    expect(parseTags(" React, TypeScript , react ,")).toEqual(["react", "typescript"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseTags("   ")).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});
