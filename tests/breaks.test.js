"use strict";

const assert = require("node:assert/strict");
const breaks = require("../breaks.js");

const cases = [
  [289, ""], [290, "B"], [335, "B"], [359, "B"],
  [360, "BB"], [365, "BB"], [374, "BB"],
  [375, "L"], [380, "L"], [425, "L"], [434, "L"],
  [435, "BL"], [440, "BL"], [530, "BL"], [554, "BL"],
  [555, "BLB"], [560, "BLB"], [620, "BLB"]
];

for (const [amplitudeMinutes, expectedCode] of cases) {
  const start = "08:00";
  const end = breaks.formatClock(breaks.timeToMinutes(start) + amplitudeMinutes);
  const result = breaks.recalculateShiftPauses({ id: `case-${amplitudeMinutes}`, start, end });
  const definitions = breaks.getPauseDefinitions(expectedCode);
  assert.equal(result.pauseRuleCode, expectedCode, `${amplitudeMinutes} minutes`);
  assert.equal(result.pauses.length, definitions.length, `${amplitudeMinutes} minutes — nombre`);
  assert.deepEqual(result.pauses.map((pause) => pause.type), definitions.map((pause) => pause.type));
  assert.equal(result.totalPauseMinutes, definitions.reduce((sum, pause) => sum + pause.durationMinutes, 0));
  assert.equal(result.validationStatus.valid, amplitudeMinutes <= 210 || amplitudeMinutes >= 290, result.validationStatus.message);
  assert.ok(result.pauses.every((pause) => pause.startOffsetMinutes >= 0 && pause.endOffsetMinutes <= amplitudeMinutes));
  assert.ok(result.pauses.every((pause, index) => index === 0 || pause.startOffsetMinutes >= result.pauses[index - 1].endOffsetMinutes));
  assert.ok(result.pauses.every((pause) => (breaks.timeToMinutes(start) + pause.startOffsetMinutes) % 5 === 0));
  if (result.validationStatus.valid) assert.ok(result.validationStatus.longestContinuousWorkMinutes <= breaks.CONSTANTS.MAX_CONTINUOUS_WORK_MINUTES);
}

assert.equal(breaks.calculateShiftAmplitude("18:00", "01:00"), 420);
assert.equal(breaks.calculateShiftAmplitude("08:00", "08:00"), 0);
assert.equal(breaks.calculateShiftAmplitude("invalid", "09:00"), null);

const observed = breaks.recalculateShiftPauses({ id: "observed", start: "10:00", end: "18:50" });
assert.equal(observed.pauseRuleCode, "BL");
assert.deepEqual(observed.pauses.map((pause) => pause.type), ["B", "L"]);
assert.equal(observed.totalPauseMinutes, 60);
assert.equal(observed.effectiveWorkingMinutes, 470);

const manual = breaks.normalizePauses([{ type: "B", startOffsetMinutes: 220, source: "manual", locked: true }], { id: "manual" });
assert.equal(manual[0].source, "manual");
assert.equal(manual[0].locked, true);
const invalid = breaks.validateContinuousWorkLimit({ start: "08:00", end: "13:00" }, manual);
assert.equal(invalid.valid, false);
assert.match(invalid.message, /210 minutes|limites/);

const impossible = breaks.recalculateShiftPauses({ id: "long", start: "00:00", end: "23:59" });
assert.equal(impossible.pauseRuleCode, "BLB");
assert.equal(impossible.validationStatus.valid, false);
assert.ok(impossible.validationStatus.longestContinuousWorkMinutes > 210);

console.log("Break tests: OK");
