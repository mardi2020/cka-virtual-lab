import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("terminal input styling", () => {
  it("hides browser textarea affordances in the command line", () => {
    expect(styles).toMatch(/\.command-line textarea\s*\{[\s\S]*resize:\s*none;/);
    expect(styles).toMatch(/\.command-line textarea::-webkit-resizer\s*\{[\s\S]*display:\s*none;/);
  });
});
