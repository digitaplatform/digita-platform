import { describe, it, expect } from "vitest";
import { jsonForScript } from "../src/lib/json-script";

describe("jsonForScript", () => {
  it("keeps a closing script tag in content from ending the element", () => {
    const value = { name: "</script><script>alert(1)</script>" };
    const out = jsonForScript(value);
    expect(out).not.toMatch(/<\/script/i);
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual(value);
  });

  it("leaves text without markup characters as plain JSON", () => {
    const value = { name: "Über uns", url: "https://example.com/de/ueber-uns" };
    expect(jsonForScript(value)).toBe(JSON.stringify(value));
  });
});
