import assert from "node:assert/strict";
import test from "node:test";

process.env.TZ = "America/New_York";
globalThis.HTMLElement = class {};
globalThis.window = {};
globalThis.customElements = { get() {}, define() {} };
const { dateString, datePresets, shiftRange } = await import("../dashboard/energy-date-range-card.js");
const date = (value) => new Date(value + "T00:00:00");
const strings = (range) => range.map(dateString);

test("presets contain dates without time selections", () => {
  const presets = datePresets(date("2026-11-16"));
  assert.deepEqual(strings(presets.Today), ["2026-11-16", "2026-11-16"]);
  assert.deepEqual(strings(presets.Yesterday), ["2026-11-15", "2026-11-15"]);
  assert.deepEqual(strings(presets["This week"]), ["2026-11-15", "2026-11-21"]);
  assert.deepEqual(strings(presets["This month"]), ["2026-11-01", "2026-11-30"]);
  assert.deepEqual(strings(presets["This year"]), ["2026-01-01", "2026-12-31"]);
  assert.deepEqual(strings(presets["Last 7 days"]), ["2026-11-10", "2026-11-16"]);
  assert.ok(Object.keys(presets).every(key => !key.includes("hour")));
});

test("month arrows handle leap years", () => {
  assert.deepEqual(
    strings(shiftRange(date("2024-01-01"), date("2024-01-31"), 1)),
    ["2024-02-01", "2024-02-29"],
  );
});

test("year arrows preserve calendar years", () => {
  assert.deepEqual(
    strings(shiftRange(date("2024-01-01"), date("2024-12-31"), 1)),
    ["2025-01-01", "2025-12-31"],
  );
});

test("custom range arrows preserve days across daylight saving", () => {
  assert.deepEqual(
    strings(shiftRange(date("2026-10-31"), date("2026-11-02"), 1)),
    ["2026-11-03", "2026-11-05"],
  );
  assert.deepEqual(
    strings(shiftRange(date("2026-11-03"), date("2026-11-05"), -1)),
    ["2026-10-31", "2026-11-02"],
  );
});
