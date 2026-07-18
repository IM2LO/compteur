(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CapBreaks = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONSTANTS = Object.freeze({
    BREAK_DURATION_MINUTES: 15,
    LUNCH_DURATION_MINUTES: 45,
    MAX_CONTINUOUS_WORK_MINUTES: 210,
    MINIMUM_BREAK_THRESHOLD_MINUTES: 290,
    ROUNDING_INTERVAL_MINUTES: 5
  });

  const RULES = Object.freeze([
    Object.freeze({ min: 0, max: 290, code: "", types: Object.freeze([]) }),
    Object.freeze({ min: 290, max: 360, code: "B", types: Object.freeze(["B"]) }),
    Object.freeze({ min: 360, max: 375, code: "BB", types: Object.freeze(["B", "B"]) }),
    Object.freeze({ min: 375, max: 435, code: "L", types: Object.freeze(["L"]) }),
    Object.freeze({ min: 435, max: 555, code: "BL", types: Object.freeze(["B", "L"]) }),
    Object.freeze({ min: 555, max: Infinity, code: "BLB", types: Object.freeze(["B", "L", "B"]) })
  ]);

  function isTime(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function timeToMinutes(value) {
    if (!isTime(value)) return null;
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function calculateShiftAmplitude(start, end) {
    const startMinutes = timeToMinutes(start);
    let endMinutes = timeToMinutes(end);
    if (startMinutes === null || endMinutes === null) return null;
    if (startMinutes === endMinutes) return 0;
    if (endMinutes < startMinutes) endMinutes += 1440;
    return endMinutes - startMinutes;
  }

  function getPauseRuleForAmplitude(amplitudeMinutes) {
    const amplitude = Number(amplitudeMinutes);
    if (!Number.isFinite(amplitude) || amplitude < 0) return "";
    const rule = RULES.find((item) => amplitude >= item.min && amplitude < item.max);
    return rule ? rule.code : "";
  }

  function getPauseDefinitions(ruleCode) {
    const rule = RULES.find((item) => item.code === String(ruleCode || ""));
    if (!rule) return [];
    return rule.types.map((type) => ({
      type,
      durationMinutes: type === "L" ? CONSTANTS.LUNCH_DURATION_MINUTES : CONSTANTS.BREAK_DURATION_MINUTES
    }));
  }

  function calculateTotalPauseMinutes(pauses) {
    if (!Array.isArray(pauses)) return 0;
    return pauses.reduce((sum, pause) => {
      const duration = Number(pause && pause.durationMinutes);
      return sum + (Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0);
    }, 0);
  }

  function formatClock(totalMinutes) {
    if (!Number.isFinite(Number(totalMinutes))) return "";
    const normalized = ((Math.round(Number(totalMinutes)) % 1440) + 1440) % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
  }

  function getPauseClock(pause, shiftStart) {
    const startMinute = timeToMinutes(shiftStart);
    const offset = Number(pause && pause.startOffsetMinutes);
    if (startMinute === null || !Number.isFinite(offset)) return { start: "", end: "", dayOffset: 0 };
    const absoluteStart = startMinute + Math.round(offset);
    const duration = Math.max(0, Math.round(Number(pause.durationMinutes) || 0));
    return {
      start: formatClock(absoluteStart),
      end: formatClock(absoluteStart + duration),
      dayOffset: Math.floor(absoluteStart / 1440),
      endDayOffset: Math.floor((absoluteStart + duration) / 1440)
    };
  }

  function getOffsetForClock(clock, shiftStart) {
    const clockMinutes = timeToMinutes(clock);
    const startMinutes = timeToMinutes(shiftStart);
    if (clockMinutes === null || startMinutes === null) return null;
    let offset = clockMinutes - startMinutes;
    if (offset < 0) offset += 1440;
    return offset;
  }

  function nearestAlignedOffset(target, minimum, maximum, shiftStartMinutes) {
    if (minimum > maximum) return Math.round(target);
    const interval = CONSTANTS.ROUNDING_INTERVAL_MINUTES;
    const absoluteTarget = shiftStartMinutes + target;
    let candidate = Math.round(absoluteTarget / interval) * interval - shiftStartMinutes;
    candidate = Math.max(minimum, Math.min(maximum, candidate));
    if ((shiftStartMinutes + candidate) % interval === 0) return candidate;
    const upward = Math.ceil((shiftStartMinutes + minimum) / interval) * interval - shiftStartMinutes;
    const downward = Math.floor((shiftStartMinutes + maximum) / interval) * interval - shiftStartMinutes;
    const aligned = [upward, downward].filter((value) => value >= minimum && value <= maximum);
    if (!aligned.length) return Math.round(candidate);
    return aligned.reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best, aligned[0]);
  }

  function calculateAutomaticPauseSchedule(shift, pauseDefinitions) {
    const amplitude = Number.isFinite(Number(shift && shift.amplitudeMinutes))
      ? Math.max(0, Math.round(Number(shift.amplitudeMinutes)))
      : calculateShiftAmplitude(shift && shift.start, shift && shift.end);
    const definitions = Array.isArray(pauseDefinitions) ? pauseDefinitions : [];
    const shiftStartMinutes = timeToMinutes(shift && shift.start);
    if (!amplitude || shiftStartMinutes === null || !definitions.length) return [];

    const totalPauseMinutes = calculateTotalPauseMinutes(definitions);
    const workMinutes = Math.max(0, amplitude - totalPauseMinutes);
    const targetSegment = workMinutes / (definitions.length + 1);
    let previousPauseEnd = 0;
    let previousPauseMinutes = 0;

    return definitions.map((definition, index) => {
      const durationMinutes = Math.max(0, Math.round(Number(definition.durationMinutes) || 0));
      const futurePauseMinutes = definitions.slice(index + 1).reduce((sum, item) => sum + Math.max(0, Math.round(Number(item.durationMinutes) || 0)), 0);
      const remainingSegments = definitions.length - index;
      const minimum = Math.max(
        previousPauseEnd,
        amplitude - durationMinutes - futurePauseMinutes - CONSTANTS.MAX_CONTINUOUS_WORK_MINUTES * remainingSegments
      );
      const maximum = Math.min(
        previousPauseEnd + CONSTANTS.MAX_CONTINUOUS_WORK_MINUTES,
        amplitude - durationMinutes - futurePauseMinutes
      );
      const target = targetSegment * (index + 1) + previousPauseMinutes;
      const startOffsetMinutes = nearestAlignedOffset(target, minimum, maximum, shiftStartMinutes);
      const endOffsetMinutes = startOffsetMinutes + durationMinutes;
      previousPauseEnd = endOffsetMinutes;
      previousPauseMinutes += durationMinutes;
      return {
        id: `${String((shift && (shift.id || shift.dateKey)) || "shift")}-pause-${index + 1}`,
        type: definition.type === "L" ? "L" : "B",
        durationMinutes,
        startOffsetMinutes,
        endOffsetMinutes,
        source: "auto",
        locked: false
      };
    });
  }

  function normalizePauses(pauses, shift) {
    if (!Array.isArray(pauses)) return [];
    return pauses.map((pause, index) => {
      const type = pause && pause.type === "L" ? "L" : "B";
      const expectedDuration = type === "L" ? CONSTANTS.LUNCH_DURATION_MINUTES : CONSTANTS.BREAK_DURATION_MINUTES;
      const startOffsetMinutes = Math.round(Number(pause && pause.startOffsetMinutes));
      const source = pause && pause.source === "manual" ? "manual" : "auto";
      return {
        id: String((pause && pause.id) || `${String((shift && (shift.id || shift.dateKey)) || "shift")}-pause-${index + 1}`),
        type,
        durationMinutes: expectedDuration,
        startOffsetMinutes: Number.isFinite(startOffsetMinutes) ? startOffsetMinutes : 0,
        endOffsetMinutes: (Number.isFinite(startOffsetMinutes) ? startOffsetMinutes : 0) + expectedDuration,
        source,
        locked: source === "manual" || Boolean(pause && pause.locked)
      };
    });
  }

  function validateContinuousWorkLimit(shift, pauses) {
    const amplitudeMinutes = calculateShiftAmplitude(shift && shift.start, shift && shift.end);
    if (amplitudeMinutes === null) {
      return { valid: false, longestContinuousWorkMinutes: 0, problemPeriod: null, message: "Les horaires du shift sont incomplets ou invalides." };
    }
    if (amplitudeMinutes <= 0) {
      return { valid: false, longestContinuousWorkMinutes: amplitudeMinutes || 0, problemPeriod: { startOffsetMinutes: 0, endOffsetMinutes: amplitudeMinutes || 0 }, message: "Le début et la fin du shift ne peuvent pas être identiques." };
    }

    const normalized = normalizePauses(pauses, shift);
    const expectedDefinitions = getPauseDefinitions(getPauseRuleForAmplitude(amplitudeMinutes));
    const expectedTypes = expectedDefinitions.map((item) => item.type).join("");
    const actualTypes = normalized.map((item) => item.type).join("");
    if (actualTypes !== expectedTypes) {
      return { valid: false, longestContinuousWorkMinutes: amplitudeMinutes, problemPeriod: null, message: `Le régime attendu est ${expectedTypes || "sans pause"}, pas ${actualTypes || "sans pause"}.` };
    }

    let cursor = 0;
    let longest = 0;
    let problemPeriod = null;
    for (const pause of normalized) {
      if (pause.startOffsetMinutes < 0 || pause.endOffsetMinutes > amplitudeMinutes) {
        return { valid: false, longestContinuousWorkMinutes: longest, problemPeriod: { startOffsetMinutes: pause.startOffsetMinutes, endOffsetMinutes: pause.endOffsetMinutes }, message: `La pause ${pause.type} sort des limites du shift.` };
      }
      if (pause.startOffsetMinutes < cursor) {
        return { valid: false, longestContinuousWorkMinutes: longest, problemPeriod: { startOffsetMinutes: pause.startOffsetMinutes, endOffsetMinutes: pause.endOffsetMinutes }, message: "Deux pauses se chevauchent ou ne sont plus dans le bon ordre." };
      }
      const segment = pause.startOffsetMinutes - cursor;
      if (segment > longest) {
        longest = segment;
        problemPeriod = { startOffsetMinutes: cursor, endOffsetMinutes: pause.startOffsetMinutes };
      }
      cursor = pause.endOffsetMinutes;
    }
    const finalSegment = amplitudeMinutes - cursor;
    if (finalSegment > longest) {
      longest = finalSegment;
      problemPeriod = { startOffsetMinutes: cursor, endOffsetMinutes: amplitudeMinutes };
    }
    const valid = longest <= CONSTANTS.MAX_CONTINUOUS_WORK_MINUTES;
    return {
      valid,
      longestContinuousWorkMinutes: longest,
      problemPeriod: valid ? null : problemPeriod,
      message: valid
        ? `Conforme : au maximum ${longest} minutes de travail consécutif.`
        : `Une période de ${longest} minutes dépasse la limite de ${CONSTANTS.MAX_CONTINUOUS_WORK_MINUTES} minutes.`
    };
  }

  function calculateEffectiveWorkingMinutes(shift, pauses) {
    const amplitude = calculateShiftAmplitude(shift && shift.start, shift && shift.end);
    if (!amplitude) return 0;
    return Math.max(0, amplitude - calculateTotalPauseMinutes(pauses));
  }

  function recalculateShiftPauses(shift) {
    const amplitudeMinutes = calculateShiftAmplitude(shift && shift.start, shift && shift.end);
    const pauseRuleCode = getPauseRuleForAmplitude(amplitudeMinutes);
    const definitions = getPauseDefinitions(pauseRuleCode);
    const pauses = calculateAutomaticPauseSchedule({ ...shift, amplitudeMinutes }, definitions);
    const validationStatus = validateContinuousWorkLimit(shift, pauses);
    return {
      amplitudeMinutes: amplitudeMinutes || 0,
      pauseRuleCode,
      pauses,
      totalPauseMinutes: calculateTotalPauseMinutes(pauses),
      effectiveWorkingMinutes: calculateEffectiveWorkingMinutes(shift, pauses),
      validationStatus
    };
  }

  return {
    CONSTANTS,
    RULES,
    isTime,
    timeToMinutes,
    formatClock,
    calculateShiftAmplitude,
    getPauseRuleForAmplitude,
    getPauseDefinitions,
    calculateAutomaticPauseSchedule,
    validateContinuousWorkLimit,
    recalculateShiftPauses,
    calculateTotalPauseMinutes,
    calculateEffectiveWorkingMinutes,
    normalizePauses,
    getPauseClock,
    getOffsetForClock
  };
}));
