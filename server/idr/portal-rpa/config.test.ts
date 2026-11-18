import { describe, it, expect } from "vitest";
import {
  loadPortalMap,
  validatePortalMap,
  countUnverifiedSelectors,
  defaultPortalMap,
  PortalMapError,
  PORTAL_MAP_VERSION,
} from "./config";

describe("portal-rpa config", () => {
  it("loads and validates the built-in default map", () => {
    const map = loadPortalMap({});
    expect(map.version).toBe(PORTAL_MAP_VERSION);
    expect(map.steps.length).toBeGreaterThanOrEqual(8);
    expect(map.steps.some((s) => s.fields.some((f) => f.action === "submit"))).toBe(true);
  });

  it("default map marks every selector unverified and counts them", () => {
    expect(countUnverifiedSelectors(defaultPortalMap)).toBeGreaterThan(20);
    for (const s of defaultPortalMap.steps) {
      for (const f of s.fields) expect(f.unverified).toBe(true);
    }
  });

  it("rejects a version mismatch (fail-closed)", () => {
    expect(() => validatePortalMap({ ...defaultPortalMap, version: "0.0.0" })).toThrow(PortalMapError);
  });

  it("rejects invalid inline JSON from PORTAL_MAP_JSON", () => {
    expect(() => loadPortalMap({ PORTAL_MAP_JSON: "{not json" })).toThrow(/not valid JSON/);
  });

  it("rejects an unreadable PORTAL_MAP_JSON path", () => {
    expect(() => loadPortalMap({ PORTAL_MAP_JSON: "/nonexistent/map.json" })).toThrow(PortalMapError);
  });

  it("accepts a valid inline JSON override", () => {
    const map = loadPortalMap({ PORTAL_MAP_JSON: JSON.stringify(defaultPortalMap) });
    expect(map.version).toBe(PORTAL_MAP_VERSION);
  });

  it("rejects a map with zero or two submit steps (never double-file)", () => {
    const noSubmit = {
      ...defaultPortalMap,
      steps: defaultPortalMap.steps.map((s) => ({ ...s, fields: s.fields.filter((f) => f.action !== "submit") })),
    };
    expect(() => validatePortalMap(noSubmit)).toThrow(/exactly one step/);
    const twoSubmit = {
      ...defaultPortalMap,
      steps: [
        ...defaultPortalMap.steps,
        {
          stepId: "SUBMIT2",
          urlPattern: "^https://x/",
          evidenceRequired: false,
          fields: [{ portalFieldKey: "control:x", selectorStrategy: { css: "button.x" }, inputType: "button", action: "submit", unverified: true }],
        },
      ],
    };
    expect(() => validatePortalMap(twoSubmit)).toThrow(/exactly one step/);
  });

  it("rejects a selector claiming live verification (unverified must be true)", () => {
    const bad = {
      ...defaultPortalMap,
      steps: defaultPortalMap.steps.map((s, i) =>
        i === 0
          ? { ...s, fields: s.fields.map((f, j) => (j === 0 ? { ...f, unverified: false } : f)) }
          : s
      ),
    };
    expect(() => validatePortalMap(bad)).toThrow(/unverified must be true/);
  });

  it("rejects a field without any selector strategy", () => {
    const bad = JSON.parse(JSON.stringify(defaultPortalMap));
    bad.steps[0].fields[0].selectorStrategy = {};
    expect(() => validatePortalMap(bad)).toThrow(PortalMapError);
  });

  it("rejects an invalid urlPattern regex", () => {
    const bad = JSON.parse(JSON.stringify(defaultPortalMap));
    bad.steps[0].urlPattern = "([unclosed";
    expect(() => validatePortalMap(bad)).toThrow(/urlPattern/);
  });
});
