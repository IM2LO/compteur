(function () {
  "use strict";

  const DAY_MS = 86400000;
  const HOUR_MS = 3600000;
  const MILESTONE_STORAGE_KEY = "contract-milestones-v1";
  const SHIFT_STORAGE_KEY = "contract-shifts-v1";
  const SETTINGS_STORAGE_KEY = "contract-tracker-settings-v2";
  const PET_STORAGE_KEY = "contract-tracker-pet-v3";
  const LEGACY_GAME_STORAGE_KEY = "contract-tracker-game-v2";
  const OPEN_STARTS = new Set(["06:35", "07:50"]);
  const CLOSE_ENDS = new Set(["22:40", "23:25"]);

  const DEFAULT_SETTINGS = {
    name: "Cap Contrat",
    start: "2026-05-14",
    end: "2026-11-01",
    restDays: [3, 4]
  };

  const COLORS = {
    gold: "#ffd15c", acid: "#d7ff4f", cyan: "#55d9e8", coral: "#ff735d", blue: "#6fa8ff",
    green: "#67dd8e", violet: "#b48cff", pink: "#ff87c8", orange: "#ff9f43", white: "#f6f3eb"
  };

  const LEVEL_NAMES = [
    "Premier pas", "En route", "Rythme trouvé", "Cap maintenu", "Mi-parcours",
    "Endurance", "Dernière ligne", "Presque là", "Sprint final", "Mission accomplie"
  ];
  const WEEKDAY_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const MONTH_HEAD = ["L", "M", "M", "J", "V", "S", "D"];
  const PET_ACTIONS = {
    feed: { food: 24, energy: 2, xp: 8, message: "Miam. Je suis prêt pour la suite !" },
    play: { mood: 22, energy: -5, clean: -2, xp: 10, message: "Encore une partie ? C'était parfait." },
    clean: { clean: 30, mood: 3, xp: 9, message: "Tout propre, tout neuf !" },
    rest: { energy: 28, food: -3, xp: 7, message: "Cette pause m'a fait du bien." }
  };

  const longDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
  const monthOnly = new Intl.DateTimeFormat("fr-FR", { month: "long" });
  const monthYear = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

  const loadedPet = loadPet();
  const state = {
    activeView: "home",
    calendarFilter: "all",
    planningFilter: "all",
    hoursPeriod: "all",
    trophyFilter: "next",
    settings: loadSettings(),
    milestones: loadMilestones(),
    shifts: loadShifts(),
    pet: loadedPet,
    previousPetVisit: loadedPet.lastVisit,
    petMessage: "",
    toastTimer: null,
    petMessageTimer: null
  };

  const $ = (id) => document.getElementById(id);

  function safeJsonParse(raw, fallback) {
    try { return raw ? JSON.parse(raw) : fallback; } catch (error) { return fallback; }
  }

  function loadSettings() {
    const saved = safeJsonParse(localStorage.getItem(SETTINGS_STORAGE_KEY), {});
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...saved });
  }

  function normalizeSettings(value) {
    const start = isDateKey(value.start) ? value.start : DEFAULT_SETTINGS.start;
    const end = isDateKey(value.end) && value.end >= start ? value.end : DEFAULT_SETTINGS.end;
    const restDays = Array.isArray(value.restDays)
      ? [...new Set(value.restDays.map(Number).filter((day) => day >= 0 && day <= 6))]
      : [...DEFAULT_SETTINGS.restDays];
    return {
      name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 32) : DEFAULT_SETTINGS.name,
      start,
      end,
      restDays: restDays.length < 7 ? restDays : [...DEFAULT_SETTINGS.restDays]
    };
  }

  function loadMilestones() {
    return normalizeMilestones(safeJsonParse(localStorage.getItem(MILESTONE_STORAGE_KEY), []));
  }

  function normalizeMilestones(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => item && typeof item.name === "string" && isDateKey(item.date))
      .map((item, index) => ({
        id: String(item.id || `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`),
        name: item.name.trim().slice(0, 42), date: item.date, color: normalizeColor(item.color), important: Boolean(item.important)
      }))
      .filter((item) => item.name);
  }

  function normalizeColor(color) {
    if (COLORS[color]) return color;
    const byHex = Object.entries(COLORS).find((entry) => entry[1].toLowerCase() === String(color).toLowerCase());
    return byHex ? byHex[0] : "gold";
  }

  function loadShifts() {
    return normalizeShifts(safeJsonParse(localStorage.getItem(SHIFT_STORAGE_KEY), {}));
  }

  function normalizeShifts(source) {
    const raw = source && source.shifts ? source.shifts : source;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const normalized = {};
    Object.entries(raw).forEach(([date, value]) => {
      if (!isDateKey(date) || !value || typeof value !== "object") return;
      normalized[date] = {
        worked: Boolean(value.worked),
        start: isTime(value.start) ? value.start : "",
        end: isTime(value.end) ? value.end : "",
        attraction: value.attraction === "HSM" || value.attraction === "STT" ? value.attraction : "",
        provisional: Boolean(value.provisional),
        note: typeof value.note === "string" ? value.note.trim().slice(0, 100) : ""
      };
    });
    return normalized;
  }

  function loadPet() {
    const now = new Date().toISOString();
    const saved = safeJsonParse(localStorage.getItem(PET_STORAGE_KEY), null);
    const legacy = safeJsonParse(localStorage.getItem(LEGACY_GAME_STORAGE_KEY), {});
    const base = {
      name: "Tempo", bornAt: now, lastUpdate: now, lastVisit: now,
      food: 82, energy: 78, mood: 84, clean: 80,
      xp: Math.max(0, Number(legacy.best) || 0), totalActions: 0,
      actionCounts: { feed: 0, play: 0, clean: 0, rest: 0 }, careDates: [], lastActionAt: 0
    };
    if (!saved || typeof saved !== "object") return base;
    return {
      ...base,
      name: typeof saved.name === "string" && saved.name.trim() ? saved.name.trim().slice(0, 16) : base.name,
      bornAt: isIsoDate(saved.bornAt) ? saved.bornAt : base.bornAt,
      lastUpdate: isIsoDate(saved.lastUpdate) ? saved.lastUpdate : base.lastUpdate,
      lastVisit: isIsoDate(saved.lastVisit) ? saved.lastVisit : base.lastVisit,
      food: normalizeNeed(saved.food, base.food), energy: normalizeNeed(saved.energy, base.energy),
      mood: normalizeNeed(saved.mood, base.mood), clean: normalizeNeed(saved.clean, base.clean),
      xp: Math.max(0, Math.floor(Number(saved.xp) || 0)), totalActions: Math.max(0, Math.floor(Number(saved.totalActions) || 0)),
      actionCounts: { ...base.actionCounts, ...(saved.actionCounts || {}) },
      careDates: Array.isArray(saved.careDates) ? [...new Set(saved.careDates.filter(isDateKey))].slice(-400) : [],
      lastActionAt: Math.max(0, Number(saved.lastActionAt) || 0)
    };
  }

  function normalizeNeed(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, 8, 100) : fallback;
  }

  function isIsoDate(value) {
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
  }

  function saveSettings() { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings)); }
  function saveMilestones() { localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(state.milestones)); }
  function saveShifts() { localStorage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(state.shifts)); }
  function savePet() { localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(state.pet)); }

  function isDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = parseDateKey(value);
    return !Number.isNaN(parsed.getTime()) && toDateKey(parsed) === value;
  }

  function isTime(value) { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }

  function parseDateKey(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function toDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function calendarNumber(date) { return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS; }
  function dayDifference(from, to) { return Math.round(calendarNumber(to) - calendarNumber(from)); }
  function addDays(date, amount) { const result = new Date(date); result.setDate(result.getDate() + amount); return result; }
  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
  function isSameDay(a, b) { return toDateKey(a) === toDateKey(b); }
  function isBaseWorkDay(date) { return !state.settings.restDays.includes(date.getDay()); }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
  }

  function getDayPlan(date) {
    const key = typeof date === "string" ? date : toDateKey(date);
    const override = state.shifts[key];
    if (override) return { ...override, custom: true };
    return { worked: isBaseWorkDay(parseDateKey(key)), start: "", end: "", attraction: "", provisional: false, note: "", custom: false };
  }

  function isPlannedWorkDay(date) { return getDayPlan(date).worked; }

  function timeToMinutes(value) {
    if (!isTime(value)) return 0;
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function shiftDurationMinutes(plan) {
    if (!plan.worked || !isTime(plan.start) || !isTime(plan.end)) return 0;
    let duration = timeToMinutes(plan.end) - timeToMinutes(plan.start);
    if (duration < 0) duration += 1440;
    return duration;
  }

  function shiftEndTimelineMinutes(record) {
    const end = timeToMinutes(record.plan.end);
    return record.plan.end <= record.plan.start ? end + 1440 : end;
  }

  function formatDuration(minutes) {
    if (!minutes) return "--";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
  }

  function formatHours(minutes) {
    return minutes ? formatDuration(minutes) : "0 h";
  }

  function getShiftRoles(plan) {
    if (!plan || !plan.worked) return [];
    const roles = [];
    if (OPEN_STARTS.has(plan.start)) roles.push("OPEN");
    if (CLOSE_ENDS.has(plan.end)) roles.push("CLOSE");
    return roles;
  }

  function getShiftRoleLabel(plan) {
    const roles = getShiftRoles(plan);
    return roles.length ? roles.join(" + ") : "STANDARD";
  }

  function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function getShiftRecord(date) {
    const plan = getDayPlan(date);
    const minutes = shiftDurationMinutes(plan);
    const roles = getShiftRoles(plan);
    return {
      date: new Date(date),
      dateKey: toDateKey(date),
      monthKey: getMonthKey(date),
      plan,
      minutes,
      roles,
      timed: minutes > 0,
      complete: Boolean(plan.worked && minutes > 0 && plan.attraction)
    };
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function applyPetDecay(now = new Date()) {
    const pet = state.pet;
    const last = new Date(pet.lastUpdate);
    const hours = clamp((now.getTime() - last.getTime()) / HOUR_MS, 0, 720);
    if (hours <= 0) return;
    pet.food = clamp(pet.food - hours * 1.65, 8, 100);
    pet.energy = clamp(pet.energy - hours * 1.05, 8, 100);
    pet.mood = clamp(pet.mood - hours * 0.72, 8, 100);
    pet.clean = clamp(pet.clean - hours * 0.58, 8, 100);
    pet.lastUpdate = now.toISOString();
  }

  function getPetStreak() {
    const dates = new Set(state.pet.careDates);
    let streak = 0;
    let cursor = parseDateKey(toDateKey(new Date()));
    if (!dates.has(toDateKey(cursor))) cursor = addDays(cursor, -1);
    while (dates.has(toDateKey(cursor))) { streak += 1; cursor = addDays(cursor, -1); }
    return streak;
  }

  function getPlanningStats(workDays) {
    const records = workDays.map(getShiftRecord);
    const timedRecords = records.filter((record) => record.timed);
    const minutes = timedRecords.reduce((sum, record) => sum + record.minutes, 0);
    const confirmedMinutes = timedRecords.filter((record) => !record.plan.provisional).reduce((sum, record) => sum + record.minutes, 0);
    const provisionalMinutes = timedRecords.filter((record) => record.plan.provisional).reduce((sum, record) => sum + record.minutes, 0);
    const complete = records.filter((record) => record.complete).length;
    const hsm = records.filter((record) => record.plan.attraction === "HSM").length;
    const stt = records.filter((record) => record.plan.attraction === "STT").length;
    const provisional = records.filter((record) => record.plan.provisional).length;
    const open = timedRecords.filter((record) => record.roles.includes("OPEN")).length;
    const close = timedRecords.filter((record) => record.roles.includes("CLOSE")).length;
    const overnight = timedRecords.filter((record) => record.plan.end <= record.plan.start).length;
    return {
      records, timedRecords, minutes, hours: minutes / 60, confirmedMinutes, provisionalMinutes,
      complete, timed: timedRecords.length, provisional, hsm, stt, open, close, overnight,
      fill: workDays.length ? complete / workDays.length * 100 : 100
    };
  }

  function getContractData(now = new Date()) {
    const start = parseDateKey(state.settings.start);
    const end = parseDateKey(state.settings.end);
    const today = parseDateKey(toDateKey(now));
    const allDays = [];
    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) allDays.push(new Date(cursor));
    const workDays = allDays.filter(isPlannedWorkDay);
    const totalDays = allDays.length;
    const beforeStart = today < start;
    const afterEnd = today > end;
    const passedCalendarDays = beforeStart ? 0 : afterEnd ? totalDays : clamp(dayDifference(start, today), 0, totalDays);
    const deadline = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 0, 0, 0);
    const startTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const duration = Math.max(1, deadline.getTime() - startTime);
    const progress = clamp((now.getTime() - startTime) / duration * 100, 0, 100);
    const remainingMs = clamp(deadline.getTime() - now.getTime(), 0, duration);
    const workDone = workDays.filter((day) => day < today).length;
    const workRemaining = workDays.filter((day) => day >= today).length;
    const totalWeeks = Math.ceil(totalDays / 7);
    const currentWeek = beforeStart ? 1 : clamp(Math.floor(dayDifference(start, today) / 7) + 1, 1, totalWeeks);
    const nextWork = workDays.find((day) => day >= today) || null;
    const pastMilestones = state.milestones.filter((item) => parseDateKey(item.date) < today).length;
    const planning = getPlanningStats(workDays);
    const xp = passedCalendarDays * 10 + pastMilestones * 50 + Math.floor(planning.hours) * 2 + state.pet.xp;
    const level = clamp(Math.floor(xp / 250) + 1, 1, 10);
    return {
      now, today, start, end, deadline, allDays, workDays, totalDays, passedCalendarDays,
      daysRemaining: Math.max(0, totalDays - passedCalendarDays), progress, remainingMs,
      workDone, workRemaining, workProgress: workDays.length ? workDone / workDays.length * 100 : 100,
      totalWeeks, currentWeek, weeksRemaining: afterEnd ? 0 : Math.max(0, totalWeeks - currentWeek + 1),
      nextWork, planning, xp, level
    };
  }

  function setText(id, text) { const element = $(id); if (element) element.textContent = text; }
  function plural(value, singular, pluralForm = `${singular}s`) { return value > 1 ? pluralForm : singular; }
  function formatPercent(value, decimals = 0) { return `${value.toFixed(decimals).replace(".", ",")} %`; }
  function capitalize(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : value; }

  function getUpcomingMilestones(today) {
    return [...state.milestones].filter((item) => parseDateKey(item.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
  }

  function sortMilestones(today) {
    return [...state.milestones].sort((a, b) => {
      const aPast = parseDateKey(a.date) < today;
      const bPast = parseDateKey(b.date) < today;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    });
  }

  function renderHome(data) {
    const days = Math.floor(data.remainingMs / DAY_MS);
    const hours = Math.floor((data.remainingMs % DAY_MS) / HOUR_MS);
    const minutes = Math.floor((data.remainingMs % HOUR_MS) / 60000);
    const seconds = Math.floor((data.remainingMs % 60000) / 1000);
    const dayFraction = data.now.getHours() / 24 + data.now.getMinutes() / 1440;
    setText("contractNameHeader", state.settings.name);
    setText("headerDate", capitalize(longDate.format(data.now)));
    setText("contractRange", `Du ${shortDate.format(data.start)} au ${shortDate.format(data.end)}`);
    setText("progressPercent", formatPercent(data.progress, 1));
    setText("levelPill", `Niveau ${data.level}`);
    setText("railToday", data.progress >= 100 ? "Terminé" : data.progress <= 0 ? "À venir" : "Aujourd'hui");
    $("progressFill").style.width = `${data.progress}%`;
    $("progressMarker").style.left = `${data.progress}%`;
    setText("countDays", days);
    setText("countdownDetail", `${String(hours).padStart(2, "0")} h · ${String(minutes).padStart(2, "0")} min · ${String(seconds).padStart(2, "0")} s`);
    $("daySlice").style.height = `${clamp(dayFraction * 100, 0, 100)}%`;
    setText("daysPassed", data.passedCalendarDays);
    setText("daysTotal", `sur ${data.totalDays}`);
    setText("workRemaining", data.workRemaining);
    setText("weeksRemaining", data.weeksRemaining);

    const next = getUpcomingMilestones(data.today)[0];
    if (next) {
      const delta = dayDifference(data.today, parseDateKey(next.date));
      setText("nextStopTitle", next.name);
      setText("nextStopDate", delta === 0 ? "Aujourd'hui" : `${capitalize(longDate.format(parseDateKey(next.date)))} · dans ${delta} ${plural(delta, "jour")}`);
      $("nextStop").style.setProperty("--next-color", COLORS[next.color]);
    } else {
      setText("nextStopTitle", "Aucun jalon à venir");
      setText("nextStopDate", "Ajoute une date importante à ta trajectoire.");
    }

    const inContract = data.today >= data.start && data.today <= data.end;
    const plan = getDayPlan(data.today);
    setText("todayStatus", inContract ? (plan.worked ? "Jour travaillé" : "Jour de repos") : (data.today < data.start ? "Avant le départ" : "Contrat terminé"));
    setText("dailyMessage", getDailyMessage(data, inContract ? plan : null));
    $("todayStatusDot").classList.toggle("off", !inContract || !plan.worked);
    setText("weekLabel", `Semaine ${data.currentWeek} sur ${data.totalWeeks}`);
    setText("nextWorkLabel", formatNextWork(data.nextWork));
    const weekElapsed = clamp(dayDifference(addDays(data.start, (data.currentWeek - 1) * 7), data.today) + dayFraction, 0, 7);
    $("weekProgress").style.width = `${weekElapsed / 7 * 100}%`;
  }

  function formatNextWork(date) {
    if (!date) return "Plus aucun service prévu";
    const plan = getDayPlan(date);
    const details = [plan.provisional ? "prévisionnel" : "", plan.start || "horaire libre", plan.attraction, getShiftRoles(plan).join(" + ")].filter(Boolean).join(" · ");
    return `Prochain service : ${shortDate.format(date)}${details ? ` · ${details}` : ""}`;
  }

  function getDailyMessage(data, plan) {
    if (data.today < data.start) return `Le départ est prévu dans ${dayDifference(data.today, data.start)} jours.`;
    if (data.today > data.end) return "La ligne d'arrivée est franchie. Mission accomplie.";
    if (!plan.worked) return "Aujourd'hui compte aussi : le temps progresse pendant le repos.";
    const details = [plan.provisional ? "prévisionnel" : "", plan.start && plan.end ? `${plan.start}–${plan.end}` : "horaires à compléter", plan.attraction, getShiftRoles(plan).join(" + ")].filter(Boolean).join(" · ");
    return `Shift du jour : ${details}. Une journée de plus vers l'arrivée.`;
  }

  function renderBarRows(containerId, items, valueFormatter = (value) => String(value)) {
    const container = $(containerId);
    if (!container) return;
    const visible = items.filter((item) => item.value > 0);
    if (!visible.length) {
      container.innerHTML = '<div class="empty-state compact-empty">Aucune donnée suffisante pour cette période.</div>';
      return;
    }
    const maximum = Math.max(...visible.map((item) => item.value), 1);
    container.innerHTML = visible.map((item) => `<div class="stat-bar-row ${item.tone || ""}">
      <div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(valueFormatter(item.value))}</strong></div>
      <div class="stat-bar-track"><i style="width:${item.value / maximum * 100}%"></i></div>
      ${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ""}
    </div>`).join("");
  }

  function renderPlanning(data) {
    const planning = data.planning;
    setText("planningDayCount", data.workDays.length);
    setText("planningTimedCount", planning.timed);
    setText("planningProvisionalCount", planning.provisional);
    setText("planningHoursTotal", formatHours(planning.minutes));

    let records = data.allDays.map(getShiftRecord);
    if (state.planningFilter === "work") records = records.filter((record) => record.plan.worked);
    if (state.planningFilter === "provisional") records = records.filter((record) => record.plan.worked && record.plan.provisional);
    if (!records.length) {
      $("planningList").innerHTML = '<div class="empty-state">Aucune journée ne correspond à ce filtre.</div>';
      return;
    }

    const grouped = records.reduce((months, record) => {
      if (!months[record.monthKey]) months[record.monthKey] = [];
      months[record.monthKey].push(record);
      return months;
    }, {});

    $("planningList").innerHTML = Object.entries(grouped).map(([monthKey, monthRecords]) => {
      const rows = monthRecords.map((record) => {
        const plan = record.plan;
        const roleTags = record.roles.length
          ? record.roles.map((role) => `<span class="shift-role ${role.toLowerCase()}">${role}</span>`).join("")
          : plan.worked ? '<span class="shift-role standard">STANDARD</span>' : "";
        const provisionalTag = plan.provisional ? '<span class="provisional-badge">Prévisionnel</span>' : "";
        const timeLabel = record.timed ? `${plan.start}–${plan.end}` : plan.worked ? "Horaires à compléter" : "Journée de repos";
        return `<button class="planning-row ${plan.worked ? "work" : "off"} ${plan.provisional ? "provisional" : ""}" type="button" data-edit-day="${record.dateKey}">
          <span class="planning-date"><strong>${WEEKDAY_SHORT[record.date.getDay()]}</strong><b>${record.date.getDate()}</b></span>
          <span class="planning-main"><strong>${escapeHtml(plan.worked ? (plan.attraction || "Sans attraction") : "Repos")}</strong><small>${escapeHtml(timeLabel)}</small>${provisionalTag}</span>
          <span class="planning-role">${roleTags}</span>
          <span class="planning-duration"><strong>${record.timed ? escapeHtml(formatDuration(record.minutes)) : "—"}</strong><small>amplitude</small></span>
        </button>`;
      }).join("");
      return `<section class="planning-month"><div class="planning-month-title"><h2>${escapeHtml(capitalize(monthYear.format(parseDateKey(`${monthKey}-01`))))}</h2><span>${monthRecords.length} ${plural(monthRecords.length, "jour")}</span></div>${rows}</section>`;
    }).join("");
  }

  function renderHours(data) {
    const monthKeys = [...new Set(data.allDays.map(getMonthKey))];
    if (state.hoursPeriod !== "all" && !monthKeys.includes(state.hoursPeriod)) state.hoursPeriod = "all";
    $("hoursPeriod").innerHTML = [
      '<option value="all">Tout le contrat</option>',
      ...monthKeys.map((key) => `<option value="${key}">${escapeHtml(capitalize(monthYear.format(parseDateKey(`${key}-01`))))}</option>`)
    ].join("");
    $("hoursPeriod").value = state.hoursPeriod;

    const records = data.planning.timedRecords.filter((record) => state.hoursPeriod === "all" || record.monthKey === state.hoursPeriod);
    const minutes = records.reduce((sum, record) => sum + record.minutes, 0);
    const confirmedMinutes = records.filter((record) => !record.plan.provisional).reduce((sum, record) => sum + record.minutes, 0);
    const provisionalMinutes = records.filter((record) => record.plan.provisional).reduce((sum, record) => sum + record.minutes, 0);
    const periodLabel = state.hoursPeriod === "all" ? "Tout le contrat" : capitalize(monthYear.format(parseDateKey(`${state.hoursPeriod}-01`)));
    setText("hoursPeriodLabel", periodLabel);
    setText("hoursGrandTotal", formatHours(minutes));
    setText("hoursShiftCount", `${records.length} ${plural(records.length, "shift")} renseigné${records.length > 1 ? "s" : ""}`);
    setText("hoursConfirmed", formatHours(confirmedMinutes));
    setText("hoursProvisional", formatHours(provisionalMinutes));
    setText("hoursAverage", records.length ? formatHours(Math.round(minutes / records.length)) : "0 h");
    setText("hoursDetailCount", records.length);

    renderBarRows("hoursAttractionBars", [
      { label: "HSM", value: records.filter((record) => record.plan.attraction === "HSM").reduce((sum, record) => sum + record.minutes, 0), tone: "cyan" },
      { label: "STT", value: records.filter((record) => record.plan.attraction === "STT").reduce((sum, record) => sum + record.minutes, 0), tone: "coral" },
      { label: "Sans attraction", value: records.filter((record) => !record.plan.attraction).reduce((sum, record) => sum + record.minutes, 0), tone: "muted" }
    ], formatHours);

    $("hoursBreakdown").innerHTML = records.length ? records.map((record) => {
      const plan = record.plan;
      return `<button class="hour-row ${plan.provisional ? "provisional" : ""}" type="button" data-edit-day="${record.dateKey}">
        <span><strong>${escapeHtml(capitalize(shortDate.format(record.date)))}</strong><small>${escapeHtml(plan.attraction || "Sans attraction")} · ${escapeHtml(getShiftRoleLabel(plan))}</small></span>
        <span><strong>${plan.start}–${plan.end}</strong><small>${plan.provisional ? "Prévisionnel" : "Confirmé"}</small></span>
        <b>${escapeHtml(formatDuration(record.minutes))}</b>
      </button>`;
    }).join("") : '<div class="empty-state">Aucun shift avec des horaires complets sur cette période.</div>';
  }

  function renderCalendar(data) {
    const currentMonthKey = `${data.today.getFullYear()}-${data.today.getMonth()}`;
    const months = [];
    let cursor = new Date(data.start.getFullYear(), data.start.getMonth(), 1, 12);
    const lastMonth = new Date(data.end.getFullYear(), data.end.getMonth(), 1, 12);
    while (cursor <= lastMonth) { months.push(new Date(cursor)); cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12); }

    $("calendarList").innerHTML = months.map((month) => {
      const key = `${month.getFullYear()}-${month.getMonth()}`;
      const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
      const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
      const leading = (first.getDay() + 6) % 7;
      const cells = Array.from({ length: leading }, () => '<span class="calendar-day empty"></span>');
      for (let day = 1; day <= last.getDate(); day += 1) {
        const date = new Date(month.getFullYear(), month.getMonth(), day, 12);
        const dateKey = toDateKey(date);
        const inContract = date >= data.start && date <= data.end;
        const plan = getDayPlan(date);
        const dateMilestones = state.milestones.filter((item) => item.date === dateKey);
        const leadMilestone = dateMilestones.find((item) => item.important) || dateMilestones[0];
        const classes = ["calendar-day", plan.worked ? "work" : "off"];
        if (!inContract) classes.push("out-contract");
        if (date < data.today) classes.push("past");
        if (isSameDay(date, data.today)) classes.push("today");
        if (leadMilestone) classes.push("milestone");
        if (dateMilestones.some((item) => item.important)) classes.push("important");
        if (plan.provisional) classes.push("provisional");
        if (state.calendarFilter === "work" && !plan.worked) classes.push("hidden-by-filter");
        if (state.calendarFilter === "off" && plan.worked) classes.push("hidden-by-filter");
        const shiftTitle = inContract && plan.worked ? [plan.provisional ? "prévisionnel" : "", plan.start && plan.end ? `${plan.start}-${plan.end}` : "horaires libres", plan.attraction, getShiftRoles(plan).join(" + ")].filter(Boolean).join(" · ") : "repos";
        const milestoneTitle = dateMilestones.length ? ` · ${dateMilestones.map((item) => item.name).join(", ")}` : "";
        const title = `${longDate.format(date)} · ${shiftTitle}${milestoneTitle}`;
        const style = leadMilestone ? ` style="--milestone-color:${COLORS[leadMilestone.color]}"` : "";
        const tag = inContract ? "button" : "span";
        const attrs = inContract ? ` type="button" data-edit-day="${dateKey}" aria-label="Configurer ${escapeHtml(longDate.format(date))}"` : "";
        cells.push(`<${tag} class="${classes.join(" ")}" title="${escapeHtml(title)}"${style}${attrs}>${day}</${tag}>`);
      }
      return `<section class="month-section ${key === currentMonthKey ? "current-month" : ""}" data-month="${key}">
        <div class="month-title"><h2>${escapeHtml(monthOnly.format(month))}</h2><span>${month.getFullYear()}</span></div>
        <div class="month-head">${MONTH_HEAD.map((label) => `<span>${label}</span>`).join("")}</div><div class="month-grid">${cells.join("")}</div>
      </section>`;
    }).join("");
  }

  function renderMilestones(data) {
    const milestones = sortMilestones(data.today);
    const upcoming = milestones.filter((item) => parseDateKey(item.date) >= data.today).length;
    setText("milestoneUpcomingCount", upcoming);
    setText("milestoneImportantCount", milestones.filter((item) => item.important).length);
    setText("milestoneDoneCount", milestones.length - upcoming);
    if (!milestones.length) {
      $("milestoneList").innerHTML = '<div class="empty-state">Aucun jalon pour le moment.<br>Le premier point de repère t’attend.</div>';
      return;
    }
    $("milestoneList").innerHTML = milestones.map((item) => {
      const date = parseDateKey(item.date);
      const delta = dayDifference(data.today, date);
      const timing = delta === 0 ? "Aujourd'hui" : delta > 0 ? `Dans ${delta} ${plural(delta, "jour")}` : `Franchi il y a ${Math.abs(delta)} ${plural(Math.abs(delta), "jour")}`;
      return `<article class="milestone-item ${item.important ? "important" : ""} ${delta < 0 ? "past" : ""}" style="--milestone-color:${COLORS[item.color]}">
        <div><h3>${escapeHtml(item.name)}</h3><p>${capitalize(longDate.format(date))} · ${timing}</p>${item.important ? '<span class="milestone-tag">Important</span>' : ""}</div>
        <button class="edit-milestone" type="button" data-edit-milestone="${escapeHtml(item.id)}" aria-label="Modifier ${escapeHtml(item.name)}">✎</button>
      </article>`;
    }).join("");
  }

  function buildAchievements(data) {
    const achievements = [];
    const add = (code, title, text, category, unlocked) => achievements.push({ code, title, text, category, unlocked });
    const progressNames = ["Échauffement", "Mise en route", "Premier cap", "Vitesse de croisière", "Quart de route", "Cap solide", "Bon rythme", "En plein élan", "Vue dégagée", "Mi-parcours", "Deuxième souffle", "Cap des 60", "Endurance", "Belle avancée", "Trois quarts", "Dernier cinquième", "L'arrivée se dessine", "Sprint final", "Presque là", "Mission accomplie"];
    for (let i = 1; i <= 20; i += 1) add(`${i * 5}%`, progressNames[i - 1], `Atteindre ${i * 5} % du contrat`, "Progression", data.progress >= i * 5);

    const dayThresholds = [1, 3, 7, 10, 14, 21, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, data.totalDays];
    dayThresholds.forEach((threshold, index) => add(`J${index + 1}`, `${threshold} jours derrière soi`, `Franchir ${threshold} jours calendaires`, "Calendrier", data.passedCalendarDays >= threshold));

    for (let i = 1; i <= 20; i += 1) {
      const threshold = Math.max(1, Math.ceil(data.workDays.length * i / 20));
      add(`S${i}`, `Service ${threshold}`, `Terminer ${threshold} jours travaillés`, "Travail", data.workDone >= threshold);
    }

    const hourThresholds = [8, 16, 40, 80, 120, 200, 300, 500, 750, 1000];
    hourThresholds.forEach((threshold, index) => add(`H${index + 1}`, `${threshold} heures au compteur`, `Planifier au moins ${threshold} heures`, "Horaires", data.planning.hours >= threshold));

    for (let i = 1; i <= 10; i += 1) add(`M${i}`, i === 1 ? "Premier repère" : `${i} jalons posés`, `Créer ${i} ${plural(i, "jalon")}`, "Jalons", state.milestones.length >= i);

    const careThresholds = [1, 5, 10, 20, 30, 50, 75, 100, 150, 250];
    careThresholds.forEach((threshold, index) => add(`T${index + 1}`, index === 0 ? "Bonjour Tempo" : `${threshold} soins`, `Prendre soin de ${state.pet.name} ${threshold} fois`, "Compagnon", state.pet.totalActions >= threshold));

    const streak = getPetStreak();
    [1, 3, 7, 14, 30].forEach((threshold, index) => add(`R${index + 1}`, `${threshold} ${plural(threshold, "jour")} ensemble`, `S'occuper de ${state.pet.name} ${threshold} jours de suite`, "Compagnon", streak >= threshold));

    const planningChecks = [
      { title: "Premier shift", text: "Renseigner un shift complet", value: data.planning.complete >= 1 },
      { title: "Planning à 25 %", text: "Compléter un quart des shifts", value: data.planning.fill >= 25 },
      { title: "Planning à moitié", text: "Compléter la moitié des shifts", value: data.planning.fill >= 50 },
      { title: "Planning à 75 %", text: "Compléter trois quarts des shifts", value: data.planning.fill >= 75 },
      { title: "Planning impeccable", text: "Compléter tous les shifts", value: data.planning.fill >= 100 }
    ];
    planningChecks.forEach((item, index) => add(`P${index + 1}`, item.title, item.text, "Planning", item.value));
    return achievements;
  }

  function renderStats(data) {
    const levelStart = (data.level - 1) * 250;
    const levelProgress = data.level === 10 ? 100 : clamp((data.xp - levelStart) / 250 * 100, 0, 100);
    setText("levelMedal", data.level);
    setText("levelName", LEVEL_NAMES[data.level - 1]);
    setText("xpLabel", `${data.xp} XP`);
    setText("nextLevelLabel", data.level === 10 ? "Niveau maximum atteint" : `Prochain niveau dans ${Math.max(0, data.level * 250 - data.xp)} XP`);
    setText("xpPercent", formatPercent(levelProgress));
    $("xpRing").style.setProperty("--xp", `${levelProgress}%`);
    const records = data.planning.timedRecords;
    const durations = records.map((record) => record.minutes);
    const averageMinutes = records.length ? Math.round(data.planning.minutes / records.length) : 0;
    const medianMinutes = Math.round(median(durations));
    const highlights = [
      { label: "Heures totales", value: formatHours(data.planning.minutes), tone: "acid" },
      { label: "Shifts renseignés", value: records.length, tone: "cyan" },
      { label: "Durée moyenne", value: formatHours(averageMinutes), tone: "gold" },
      { label: "Durée médiane", value: formatHours(medianMinutes), tone: "violet" },
      { label: "Heures confirmées", value: formatHours(data.planning.confirmedMinutes), tone: "green" },
      { label: "Heures prévisionnelles", value: formatHours(data.planning.provisionalMinutes), tone: "coral" },
      { label: "Shifts OPEN", value: data.planning.open, tone: "cyan" },
      { label: "Shifts CLOSE", value: data.planning.close, tone: "coral" }
    ];
    $("statsHighlights").innerHTML = highlights.map((item) => `<article class="${item.tone}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></article>`).join("");

    const missingTimes = Math.max(0, data.workDays.length - data.planning.timed);
    const missingAttraction = data.planning.records.filter((record) => record.timed && !record.plan.attraction).length;
    setText("statsCompletionRate", formatPercent(data.planning.fill));
    $("statsCompletionBar").style.width = `${data.planning.fill}%`;
    $("statsQualityGrid").innerHTML = [
      [data.workDays.length, "jours travaillés"],
      [data.planning.timed, "horaires complets"],
      [data.planning.complete, "shifts complets"],
      [missingTimes, "horaires manquants"],
      [missingAttraction, "attractions manquantes"],
      [data.planning.provisional, "prévisionnels"]
    ].map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");

    const attractionItems = ["HSM", "STT", ""].map((attraction) => {
      const matching = records.filter((record) => record.plan.attraction === attraction);
      return {
        label: attraction || "Sans attraction",
        value: matching.reduce((sum, record) => sum + record.minutes, 0),
        detail: `${matching.length} ${plural(matching.length, "shift")}`,
        tone: attraction === "HSM" ? "cyan" : attraction === "STT" ? "coral" : "muted"
      };
    });
    renderBarRows("statsAttractionBars", attractionItems, formatHours);

    const openOnly = records.filter((record) => record.roles.length === 1 && record.roles[0] === "OPEN").length;
    const closeOnly = records.filter((record) => record.roles.length === 1 && record.roles[0] === "CLOSE").length;
    const openClose = records.filter((record) => record.roles.length === 2).length;
    const standard = records.filter((record) => !record.roles.length).length;
    renderBarRows("statsRoleBars", [
      { label: "OPEN", value: openOnly, tone: "cyan" },
      { label: "CLOSE", value: closeOnly, tone: "coral" },
      { label: "OPEN + CLOSE", value: openClose, tone: "gold" },
      { label: "Standard", value: standard, tone: "muted" }
    ], (value) => `${value} ${plural(value, "shift")}`);

    const monthItems = [...new Set(data.allDays.map(getMonthKey))].map((key) => ({
      label: capitalize(monthYear.format(parseDateKey(`${key}-01`))),
      key,
      value: records.filter((record) => record.monthKey === key).reduce((sum, record) => sum + record.minutes, 0),
      tone: "acid"
    }));
    renderBarRows("statsMonthBars", monthItems, formatHours);

    const weekdayItems = WEEKDAY_ORDER.map((day) => ({
      label: WEEKDAY_SHORT[day],
      day,
      value: records.filter((record) => record.date.getDay() === day).reduce((sum, record) => sum + record.minutes, 0),
      tone: "violet"
    }));
    renderBarRows("statsWeekdayBars", weekdayItems, formatHours);

    const longest = records.reduce((best, record) => !best || record.minutes > best.minutes ? record : best, null);
    const shortest = records.reduce((best, record) => !best || record.minutes < best.minutes ? record : best, null);
    const earliest = records.reduce((best, record) => !best || record.plan.start < best.plan.start ? record : best, null);
    const latest = records.reduce((best, record) => !best || shiftEndTimelineMinutes(record) > shiftEndTimelineMinutes(best) ? record : best, null);
    const busiestMonth = monthItems.reduce((best, item) => !best || item.value > best.value ? item : best, null);
    const busiestWeekday = weekdayItems.reduce((best, item) => !best || item.value > best.value ? item : best, null);
    const recordItems = [
      { label: "Shift le plus long", value: longest ? formatDuration(longest.minutes) : "—", detail: longest ? capitalize(shortDate.format(longest.date)) : "Aucune donnée" },
      { label: "Shift le plus court", value: shortest ? formatDuration(shortest.minutes) : "—", detail: shortest ? capitalize(shortDate.format(shortest.date)) : "Aucune donnée" },
      { label: "Début le plus tôt", value: earliest ? earliest.plan.start : "—", detail: earliest ? capitalize(shortDate.format(earliest.date)) : "Aucune donnée" },
      { label: "Fin la plus tardive", value: latest ? latest.plan.end : "—", detail: latest ? capitalize(shortDate.format(latest.date)) : "Aucune donnée" },
      { label: "Mois le plus chargé", value: busiestMonth && busiestMonth.value ? formatHours(busiestMonth.value) : "—", detail: busiestMonth && busiestMonth.value ? busiestMonth.label : "Aucune donnée" },
      { label: "Jour le plus chargé", value: busiestWeekday && busiestWeekday.value ? formatHours(busiestWeekday.value) : "—", detail: busiestWeekday && busiestWeekday.value ? busiestWeekday.label : "Aucune donnée" },
      { label: "Shifts de nuit", value: data.planning.overnight, detail: "fin après minuit" },
      { label: "Moyenne par semaine", value: formatHours(Math.round(data.planning.minutes / Math.max(1, data.totalWeeks))), detail: `${data.totalWeeks} ${plural(data.totalWeeks, "semaine")}` }
    ];
    $("statsRecords").innerHTML = recordItems.map((item) => `<article><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.detail)}</small></article>`).join("");

    const achievements = buildAchievements(data);
    const unlocked = achievements.filter((item) => item.unlocked);
    let visible = achievements;
    if (state.trophyFilter === "unlocked") visible = unlocked;
    if (state.trophyFilter === "next") visible = [...unlocked.slice(-6), ...achievements.filter((item) => !item.unlocked).slice(0, 12)];
    setText("achievementCount", `${unlocked.length}/${achievements.length}`);
    $("achievementGrid").innerHTML = visible.length ? visible.map((item) => `<article class="achievement ${item.unlocked ? "" : "locked"}"><i>${item.code}</i><strong>${item.title}</strong><span>${item.text}</span><span class="achievement-category">${item.category}</span></article>`).join("") : '<div class="empty-state">Aucun trophée débloqué pour le moment.</div>';
  }

  function renderPet() {
    applyPetDecay();
    const pet = state.pet;
    const average = (pet.food + pet.energy + pet.mood + pet.clean) / 4;
    const age = Math.max(1, Math.floor((Date.now() - new Date(pet.bornAt).getTime()) / DAY_MS) + 1);
    const level = Math.floor(pet.xp / 100) + 1;
    const streak = getPetStreak();
    const hour = new Date().getHours();
    const previousVisit = new Date(state.previousPetVisit);
    const visitMinutes = Math.max(0, Math.floor((Date.now() - previousVisit.getTime()) / 60000));
    setText("gameTitle", pet.name);
    setText("petAge", `Jour ${age}`);
    setText("petLevel", level);
    setText("petStreak", `${streak} j`);
    setText("petXp", `${pet.xp} XP`);
    setText("petActionsCount", pet.totalActions);
    setText("petLastVisit", visitMinutes < 1 ? "maintenant" : visitMinutes < 60 ? `il y a ${visitMinutes} min` : `il y a ${Math.floor(visitMinutes / 60)} h`);
    setPetNeed("Food", pet.food);
    setPetNeed("Energy", pet.energy);
    setPetNeed("Mood", pet.mood);
    setPetNeed("Clean", pet.clean);
    $("petWorld").classList.toggle("night", hour < 7 || hour >= 20);
    $("petAvatar").classList.toggle("tired", pet.energy < 32);
    $("petAvatar").classList.toggle("sad", pet.mood < 35 || pet.food < 28);
    $("petAvatar").classList.toggle("dirty", pet.clean < 35);
    $("petAvatar").setAttribute("aria-label", `${pet.name} est ${average >= 70 ? "en pleine forme" : average >= 40 ? "un peu fatigué" : "en demande d'attention"}`);
    const status = getPetStatus(average);
    setText("petStatusTitle", status.title);
    setText("petStatusText", status.text);
    setText("petSpeech", state.petMessage || getPetSpeech(pet, average));
    savePet();
  }

  function setPetNeed(name, value) {
    const rounded = Math.round(value);
    setText(`pet${name}`, `${rounded} %`);
    const bar = $(`pet${name}Bar`);
    bar.style.width = `${rounded}%`;
    bar.classList.toggle("low", rounded < 30);
  }

  function getPetStatus(average) {
    if (average >= 80) return { title: "En pleine forme", text: `${state.pet.name} rayonne et gagne de l'expérience à chaque soin.` };
    if (average >= 55) return { title: "Tout va bien", text: `${state.pet.name} avance tranquillement à tes côtés.` };
    if (average >= 35) return { title: "Un peu d'attention", text: `Un petit soin ferait beaucoup de bien à ${state.pet.name}.` };
    return { title: "Besoin de toi", text: `${state.pet.name} ne peut pas mourir, mais il aimerait vraiment te revoir.` };
  }

  function getPetSpeech(pet, average) {
    if (pet.food < 30) return "J'ai un petit creux...";
    if (pet.energy < 30) return "Une sieste et je repars.";
    if (pet.clean < 30) return "Je crois que j'ai besoin d'un bain.";
    if (pet.mood < 30) return "On joue un peu ensemble ?";
    if (average > 82) return "On garde le cap ensemble !";
    return "Content de te revoir.";
  }

  function performPetAction(actionName) {
    const action = PET_ACTIONS[actionName];
    if (!action) return;
    const now = Date.now();
    if (now - state.pet.lastActionAt < 1800) {
      showToast("Laisse-lui juste une petite seconde");
      return;
    }
    applyPetDecay(new Date(now));
    ["food", "energy", "mood", "clean"].forEach((need) => {
      if (typeof action[need] === "number") state.pet[need] = clamp(state.pet[need] + action[need], 8, 100);
    });
    state.pet.xp += action.xp;
    state.pet.totalActions += 1;
    state.pet.actionCounts[actionName] = Math.max(0, Number(state.pet.actionCounts[actionName]) || 0) + 1;
    state.pet.lastActionAt = now;
    const todayKey = toDateKey(new Date());
    if (!state.pet.careDates.includes(todayKey)) state.pet.careDates.push(todayKey);
    state.pet.careDates = state.pet.careDates.slice(-400);
    state.petMessage = action.message;
    clearTimeout(state.petMessageTimer);
    state.petMessageTimer = setTimeout(() => { state.petMessage = ""; renderPet(); }, 3200);
    savePet();
    const avatar = $("petAvatar");
    avatar.classList.remove("celebrate");
    void avatar.offsetWidth;
    avatar.classList.add("celebrate");
    if (navigator.vibrate) navigator.vibrate([18, 35, 18]);
    renderPet();
    renderStats(getContractData());
  }

  function renderAll() {
    applyPetDecay();
    const data = getContractData();
    renderHome(data);
    renderPlanning(data);
    renderHours(data);
    renderCalendar(data);
    renderMilestones(data);
    renderStats(data);
    renderPet();
    updateFormBounds();
  }

  function activateView(view) {
    if (!$("view-" + view)) return;
    state.activeView = view;
    document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
    document.querySelectorAll(".bottom-nav [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    window.scrollTo({ top: 0, behavior: "smooth" });
    const data = getContractData();
    if (view === "planning") renderPlanning(data);
    if (view === "hours") renderHours(data);
    if (view === "stats") renderStats(data);
    if (view === "game") renderPet();
  }

  function createFormOptions() {
    $("colorOptions").innerHTML = Object.entries(COLORS).map(([name, value], index) => `<label class="color-option" title="${name}"><input type="radio" name="milestoneColor" value="${name}" ${index === 0 ? "checked" : ""}><span style="--swatch:${value}"></span></label>`).join("");
    $("restDayOptions").innerHTML = WEEKDAY_ORDER.map((day) => `<label class="rest-option"><input type="checkbox" name="restDay" value="${day}"><span>${WEEKDAY_SHORT[day]}</span></label>`).join("");
  }

  function updateFormBounds() { $("milestoneDate").min = state.settings.start; $("milestoneDate").max = state.settings.end; }
  function openSheet(sheet) { $("sheetBackdrop").hidden = false; sheet.hidden = false; document.body.style.overflow = "hidden"; }
  function closeSheets() { $("sheetBackdrop").hidden = true; document.querySelectorAll(".bottom-sheet").forEach((sheet) => { sheet.hidden = true; }); document.body.style.overflow = ""; }

  function resetMilestoneForm() {
    $("milestoneForm").reset();
    $("milestoneEditId").value = "";
    document.querySelector('input[name="milestoneColor"][value="gold"]').checked = true;
    setText("milestoneSheetTitle", "Nouveau jalon");
    setText("saveMilestone", "Ajouter le jalon");
    $("deleteMilestone").hidden = true;
    updateFormBounds();
  }

  function openMilestoneEditor(id = null) {
    resetMilestoneForm();
    if (id) {
      const item = state.milestones.find((milestone) => milestone.id === id);
      if (!item) return;
      $("milestoneEditId").value = item.id;
      $("milestoneName").value = item.name;
      $("milestoneDate").value = item.date;
      $("milestoneImportant").checked = item.important;
      const color = document.querySelector(`input[name="milestoneColor"][value="${item.color}"]`);
      if (color) color.checked = true;
      setText("milestoneSheetTitle", "Modifier le jalon");
      setText("saveMilestone", "Enregistrer les changements");
      $("deleteMilestone").hidden = false;
    } else {
      const data = getContractData();
      $("milestoneDate").value = toDateKey(new Date(Math.min(Math.max(data.today.getTime(), data.start.getTime()), data.end.getTime())));
    }
    openSheet($("milestoneSheet"));
    setTimeout(() => $("milestoneName").focus(), 150);
  }

  function openDayEditor(dateKey) {
    if (!isDateKey(dateKey)) return;
    const plan = getDayPlan(dateKey);
    const date = parseDateKey(dateKey);
    $("dayEditDate").value = dateKey;
    setText("daySheetTitle", capitalize(new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(date)));
    setText("daySheetDate", capitalize(longDate.format(date)));
    $("dayWorked").checked = plan.worked;
    $("dayProvisional").checked = Boolean(plan.provisional);
    $("shiftStart").value = plan.start;
    $("shiftEnd").value = plan.end;
    $("shiftNote").value = plan.note;
    const attraction = document.querySelector(`input[name="attraction"][value="${plan.attraction}"]`);
    if (attraction) attraction.checked = true;
    updateDayFormState();
    openSheet($("daySheet"));
  }

  function updateDayFormState() {
    const worked = $("dayWorked").checked;
    if (!worked) $("dayProvisional").checked = false;
    [$("shiftStart"), $("shiftEnd"), $("shiftNote")].forEach((input) => { input.disabled = !worked; });
    $("dayProvisional").disabled = !worked;
    document.querySelectorAll('input[name="attraction"]').forEach((input) => { input.disabled = !worked; });
    $("dayForm").querySelector(".shift-time-fields").classList.toggle("disabled", !worked);
    $("dayForm").querySelector(".attraction-field").classList.toggle("disabled", !worked);
    $("dayForm").querySelector(".provisional-toggle").classList.toggle("disabled", !worked);
    $("shiftNote").closest(".field").classList.toggle("disabled", !worked);
    updateShiftDuration();
  }

  function updateShiftDuration() {
    const plan = { worked: $("dayWorked").checked, start: $("shiftStart").value, end: $("shiftEnd").value };
    setText("shiftDuration", formatDuration(shiftDurationMinutes(plan)));
    const roles = getShiftRoles(plan);
    const status = $("shiftAutoStatus");
    status.textContent = roles.length ? roles.join(" + ") : "STANDARD";
    status.classList.toggle("open", roles.includes("OPEN"));
    status.classList.toggle("close", roles.includes("CLOSE"));
  }

  function openSettings() {
    $("contractNameInput").value = state.settings.name;
    $("petNameInput").value = state.pet.name;
    $("contractStartInput").value = state.settings.start;
    $("contractEndInput").value = state.settings.end;
    document.querySelectorAll('input[name="restDay"]').forEach((input) => { input.checked = state.settings.restDays.includes(Number(input.value)); });
    setText("backupStatus", "");
    setText("shiftBackupStatus", "");
    openSheet($("settingsSheet"));
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    state.toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2600);
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function getBackupPayload() {
    return {
      app: "cap-contrat", version: 3, savedAt: new Date().toISOString(), settings: state.settings,
      contract: { start: state.settings.start, end: state.settings.end, restDays: state.settings.restDays },
      milestones: state.milestones, pet: state.pet
    };
  }

  function exportBackup() {
    downloadJson(getBackupPayload(), `cap-contrat-sauvegarde-${toDateKey(new Date())}.json`);
    setText("backupStatus", "Sauvegarde générale exportée.");
  }

  function exportShifts() {
    const payload = {
      app: "cap-contrat-shifts", version: 2, savedAt: new Date().toISOString(),
      contract: { start: state.settings.start, end: state.settings.end }, shifts: state.shifts
    };
    downloadJson(payload, `cap-contrat-shifts-${toDateKey(new Date())}.json`);
    setText("shiftBackupStatus", `${Object.keys(state.shifts).length} journées exportées dans un fichier séparé.`);
  }

  async function importBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const milestoneSource = Array.isArray(parsed) ? parsed : parsed.milestones;
      if (!Array.isArray(milestoneSource)) throw new Error("Aucun jalon trouvé");
      state.milestones = normalizeMilestones(milestoneSource);
      saveMilestones();
      if (!Array.isArray(parsed)) {
        const settingsSource = parsed.settings || (parsed.contract ? { ...parsed.contract, name: state.settings.name } : null);
        if (settingsSource) { state.settings = normalizeSettings({ ...state.settings, ...settingsSource }); saveSettings(); }
        if (parsed.pet && typeof parsed.pet === "object") {
          localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(parsed.pet));
          const importedPet = loadPet();
          Object.assign(state.pet, importedPet);
        }
      }
      renderAll();
      setText("backupStatus", `${state.milestones.length} ${plural(state.milestones.length, "jalon")} restauré${state.milestones.length > 1 ? "s" : ""}.`);
      showToast("Sauvegarde restaurée avec succès");
    } catch (error) {
      setText("backupStatus", "Import impossible : fichier invalide ou incompatible.");
    }
  }

  async function importShifts(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const source = parsed && parsed.shifts ? parsed.shifts : parsed;
      if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Planning absent");
      state.shifts = normalizeShifts(source);
      saveShifts();
      renderAll();
      setText("shiftBackupStatus", `${Object.keys(state.shifts).length} journées de planning restaurées.`);
      showToast("Planning des shifts restauré");
    } catch (error) {
      setText("shiftBackupStatus", "Import impossible : ce fichier ne contient pas de shifts valides.");
    }
  }

  function bindEvents() {
    document.querySelectorAll(".bottom-nav [data-view]").forEach((button) => button.addEventListener("click", () => activateView(button.dataset.view)));
    document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => activateView(button.dataset.go)));
    $("openSettings").addEventListener("click", openSettings);
    $("sheetBackdrop").addEventListener("click", closeSheets);
    document.querySelectorAll("[data-close-sheet]").forEach((button) => button.addEventListener("click", closeSheets));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSheets(); });

    $("calendarFilter").addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.calendarFilter = button.dataset.filter;
      document.querySelectorAll("#calendarFilter button").forEach((item) => item.classList.toggle("active", item === button));
      renderCalendar(getContractData());
    });
    $("calendarList").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-day]"); if (button) openDayEditor(button.dataset.editDay); });

    $("planningFilter").addEventListener("click", (event) => {
      const button = event.target.closest("[data-planning-filter]");
      if (!button) return;
      state.planningFilter = button.dataset.planningFilter;
      document.querySelectorAll("#planningFilter button").forEach((item) => item.classList.toggle("active", item === button));
      renderPlanning(getContractData());
    });
    $("planningList").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-day]"); if (button) openDayEditor(button.dataset.editDay); });
    $("hoursPeriod").addEventListener("change", (event) => { state.hoursPeriod = event.target.value; renderHours(getContractData()); });
    $("hoursBreakdown").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-day]"); if (button) openDayEditor(button.dataset.editDay); });

    $("jumpCurrentMonth").addEventListener("click", () => {
      const data = getContractData();
      const target = document.querySelector(`[data-month="${data.today.getFullYear()}-${data.today.getMonth()}"]`) || $("calendarList").firstElementChild;
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    $("addMilestone").addEventListener("click", () => openMilestoneEditor());
    $("milestoneList").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-milestone]"); if (button) openMilestoneEditor(button.dataset.editMilestone); });
    $("milestoneForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const id = $("milestoneEditId").value;
      const name = $("milestoneName").value.trim();
      const date = $("milestoneDate").value;
      const selectedColor = document.querySelector('input[name="milestoneColor"]:checked');
      if (!name || !isDateKey(date) || !selectedColor) return;
      const item = { id: id || `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: name.slice(0, 42), date, color: normalizeColor(selectedColor.value), important: $("milestoneImportant").checked };
      state.milestones = id ? state.milestones.map((milestone) => milestone.id === id ? item : milestone) : [...state.milestones, item];
      saveMilestones(); closeSheets(); renderAll(); showToast(id ? "Jalon mis à jour" : "Nouveau jalon ajouté");
    });
    $("deleteMilestone").addEventListener("click", () => {
      const id = $("milestoneEditId").value;
      const item = state.milestones.find((milestone) => milestone.id === id);
      if (!item || !window.confirm(`Supprimer le jalon « ${item.name} » ?`)) return;
      state.milestones = state.milestones.filter((milestone) => milestone.id !== id);
      saveMilestones(); closeSheets(); renderAll(); showToast("Jalon supprimé");
    });

    $("dayWorked").addEventListener("change", updateDayFormState);
    $("shiftStart").addEventListener("input", updateShiftDuration);
    $("shiftEnd").addEventListener("input", updateShiftDuration);
    $("dayForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const date = $("dayEditDate").value;
      if (!isDateKey(date)) return;
      const attraction = document.querySelector('input[name="attraction"]:checked');
      state.shifts[date] = {
        worked: $("dayWorked").checked,
        start: isTime($("shiftStart").value) ? $("shiftStart").value : "",
        end: isTime($("shiftEnd").value) ? $("shiftEnd").value : "",
        attraction: attraction && (attraction.value === "HSM" || attraction.value === "STT") ? attraction.value : "",
        provisional: $("dayWorked").checked && $("dayProvisional").checked,
        note: $("shiftNote").value.trim().slice(0, 100)
      };
      saveShifts(); closeSheets(); renderAll(); showToast("Journée enregistrée dans le planning");
    });
    $("resetDay").addEventListener("click", () => {
      const date = $("dayEditDate").value;
      if (!isDateKey(date)) return;
      delete state.shifts[date];
      saveShifts(); closeSheets(); renderAll(); showToast("Planning par défaut rétabli");
    });

    $("trophyFilter").addEventListener("click", (event) => {
      const button = event.target.closest("[data-trophy-filter]");
      if (!button) return;
      state.trophyFilter = button.dataset.trophyFilter;
      document.querySelectorAll("#trophyFilter button").forEach((item) => item.classList.toggle("active", item === button));
      renderStats(getContractData());
    });

    document.querySelectorAll("[data-pet-action]").forEach((button) => button.addEventListener("click", () => performPetAction(button.dataset.petAction)));

    $("settingsForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const start = $("contractStartInput").value;
      const end = $("contractEndInput").value;
      const restDays = [...document.querySelectorAll('input[name="restDay"]:checked')].map((input) => Number(input.value));
      if (!isDateKey(start) || !isDateKey(end) || end < start) { showToast("La date de fin doit suivre la date de début"); return; }
      if (restDays.length === 7) { showToast("Il faut conserver au moins un jour travaillé"); return; }
      state.settings = normalizeSettings({ name: $("contractNameInput").value, start, end, restDays });
      state.pet.name = $("petNameInput").value.trim().slice(0, 16) || "Tempo";
      saveSettings(); savePet(); closeSheets(); renderAll(); showToast("Réglages enregistrés");
    });

    $("exportBackup").addEventListener("click", exportBackup);
    $("importBackup").addEventListener("click", () => $("backupFile").click());
    $("backupFile").addEventListener("change", async (event) => { const file = event.target.files && event.target.files[0]; if (file) await importBackup(file); event.target.value = ""; });
    $("exportShifts").addEventListener("click", exportShifts);
    $("importShifts").addEventListener("click", () => $("shiftBackupFile").click());
    $("shiftBackupFile").addEventListener("change", async (event) => { const file = event.target.files && event.target.files[0]; if (file) await importShifts(file); event.target.value = ""; });
  }

  createFormOptions();
  bindEvents();
  applyPetDecay();
  state.pet.lastVisit = new Date().toISOString();
  savePet();
  renderAll();
  setInterval(() => {
    if (state.activeView === "home") renderHome(getContractData());
    if (state.activeView === "game") renderPet();
  }, 1000);
}());
