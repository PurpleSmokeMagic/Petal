/*
 * Petal engine: data model, cycle engine and state store.
 *
 * Plain JavaScript, no build step, no dependencies. Works three ways:
 *   1. <script src="petal-engine.js"></script>  ->  window.Petal
 *   2. Pasted inline into a single file HTML app ->  window.Petal
 *   3. require('./petal-engine.js') in Node      ->  module.exports (used by the tests)
 *
 * Rules are documented in docs/CYCLE_ENGINE.md and docs/DATA_MODEL.md.
 * All dates are stored as local calendar dates in "YYYY-MM-DD" form. Derived values
 * (cycle day, phase, predictions, scores) are computed on read, never stored.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Petal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'petal.state.v1';

  /* ------------------------------------------------------------------ */
  /* Enums and catalogs                                                  */
  /* ------------------------------------------------------------------ */

  // `token` is the CSS custom property in design/petal.css (fill, then ink for text).
  const PHASES = {
    menstrual: {
      key: 'menstrual', label: 'Menstrual', token: '--period', inkToken: '--period-ink',
      focus: 'Iron, magnesium and B vitamins',
      work: 'Administrative and low pressure work',
      training: 'Restorative movement: walking, gentle yoga, stretching',
    },
    follicular: {
      key: 'follicular', label: 'Follicular', token: '--follicular', inkToken: '--follicular-ink',
      focus: 'Fresh produce and lean protein',
      work: 'Strategic planning and learning',
      training: 'Rising intensity: strength and cardio',
    },
    ovulation: {
      key: 'ovulation', label: 'Ovulation', token: '--ovulation', inkToken: '--ovulation-ink',
      focus: 'Fibre and antioxidants',
      work: 'Presentations, negotiations and social tasks',
      training: 'Peak training: heavy lifts, HIIT',
    },
    luteal: {
      key: 'luteal', label: 'Luteal', token: '--luteal', inkToken: '--luteal-ink',
      focus: 'Complex carbs',
      work: 'Finish and tidy up, avoid starting large projects late in the phase',
      training: 'Moderate and low impact: pilates, steady cardio',
    },
  };
  const PHASE_ORDER = ['menstrual', 'follicular', 'ovulation', 'luteal'];

  const ACTIVITY_TIERS = {
    1: { label: 'Sedentary', description: 'Desk job, minimal walking during the day.', factor: 1.2 },
    2: { label: 'Lightly active', description: 'Standing job or casual walking throughout the day.', factor: 1.375 },
    3: { label: 'Moderately active', description: 'Regular daily movement or physically active tasks.', factor: 1.55 },
    4: { label: 'Very active', description: 'Physical labour or demanding daily exertion.', factor: 1.725 },
  };

  const FLOW = ['light', 'medium', 'heavy'];
  const GOALS = ['loss', 'gain', 'maintain'];
  const CONDITIONS = ['pcos', 'endometriosis', 'thyroid', 'diabetes', 'blood_pressure', 'none'];
  const DIET_STYLES = ['halal', 'carnivore', 'vegan', 'vegetarian', 'keto', 'mediterranean', 'none'];
  const ALLERGY_PRESETS = ['gluten', 'dairy', 'nuts', 'soy', 'shellfish'];
  const OCCUPATIONS = ['student', 'professional', 'homemaker', 'freelancer'];
  const WORKOUT_PREFERENCES = ['weights', 'pilates', 'yoga', 'running', 'hiit', 'swimming', 'cycling', 'walking', 'barre'];
  const WORKOUT_TYPES = ['weights', 'pilates', 'yoga', 'running', 'walking', 'other'];
  const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
  const TASK_TYPES = ['work', 'study', 'personal', 'home'];
  const TASK_EFFORT = ['light', 'medium', 'deep'];
  const TASK_STATUS = ['pending', 'done', 'missed'];

  const MOODS = {
    energized: { label: 'Energized', score: 2 },
    calm: { label: 'Calm', score: 1 },
    focused: { label: 'Focused', score: 1 },
    anxious: { label: 'Anxious', score: -1 },
    irritable: { label: 'Irritable', score: -1 },
    bloated: { label: 'Bloated', score: -1 },
    exhausted: { label: 'Exhausted', score: -2 },
  };

  // Kept in one place so a nutrition reviewer can tune it.
  const NUTRITION_CONFIG = {
    defaultAge: 30,               // used when no date of birth is given
    goalAdjust: { loss: -0.15, gain: 0.10, maintain: 0 },
    lateLutealDays: 7,            // last N days of the cycle count as late luteal
    lateLutealKcal: 100,
    macroSplit: { carbs: 0.45, protein: 0.25, fat: 0.30 },
    lateLutealMacroSplit: { carbs: 0.50, protein: 0.22, fat: 0.28 },
    kcalPerGram: { carbs: 4, protein: 4, fat: 9 },
    micronutrientFocus: {
      menstrual: ['iron', 'magnesium', 'b_vitamins'],
      follicular: ['vitamin_e', 'zinc'],
      ovulation: ['fibre', 'antioxidants'],
      luteal: ['magnesium', 'calcium', 'vitamin_b6'],
    },
  };

  const CYCLE_LIMITS = {
    cycleLength: { min: 21, max: 45, default: 28 },
    periodLength: { min: 2, max: 10, default: 5 },
    pain: { min: 1, max: 10 },
  };

  /* ------------------------------------------------------------------ */
  /* Date helpers (local calendar dates, timezone safe)                  */
  /* ------------------------------------------------------------------ */

  const DAY_MS = 86400000;
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isISODate(value) {
    if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // Accepts "YYYY-MM-DD" or a Date. Dates are read in local time, then kept as calendar days.
  function toISODate(value) {
    if (typeof value === 'string') {
      if (!isISODate(value)) throw new Error('Invalid date: ' + value);
      return value;
    }
    if (value instanceof Date && !isNaN(value)) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
    throw new Error('Invalid date: ' + value);
  }

  function dayNumber(iso) {
    const [y, m, d] = toISODate(iso).split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  }

  function fromDayNumber(n) {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return dayNumber(b) - dayNumber(a);
  }

  function addDays(iso, n) {
    return fromDayNumber(dayNumber(iso) + n);
  }

  function today(now) {
    return toISODate(now || new Date());
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function toInt(value, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : fallback;
  }

  // Avatar choices. The photo is a small JPEG made on the phone; emoji and colours come from fixed lists.
  const AVATAR_COLORS = ['plum', 'coral', 'mint', 'sun', 'sky'];
  const AVATAR_EMOJIS = ['\u{1F338}', '\u{1F33A}', '\u{1F33F}', '\u{1F319}', '\u2600\uFE0F', '\u{1F98B}', '\u{1F431}', '\u{1F3C3}\u200D\u2640\uFE0F', '\u{1F9D8}\u200D\u2640\uFE0F', '\u{1F4DA}', '\u{1F353}', '\u2728'];
  const AVATAR_PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
  const AVATAR_PHOTO_MAX = 120000;
  function normalizeAvatar(a) {
    const v = a && typeof a === 'object' ? a : {};
    const out = { kind: 'initial', color: AVATAR_COLORS.includes(v.color) ? v.color : 'plum', emoji: AVATAR_EMOJIS.includes(v.emoji) ? v.emoji : AVATAR_EMOJIS[0], photo: '' };
    if (typeof v.photo === 'string' && v.photo.length <= AVATAR_PHOTO_MAX && AVATAR_PHOTO_RE.test(v.photo)) out.photo = v.photo;
    if (v.kind === 'emoji') out.kind = 'emoji';
    if (v.kind === 'photo' && out.photo) out.kind = 'photo';
    return out;
  }

  // Whole years between a date of birth and a day, or null.
  function ageOn(birthDate, todayIso) {
    if (!isISODate(birthDate) || !isISODate(todayIso) || birthDate > todayIso) return null;
    const [by, bm, bd] = birthDate.split('-').map(Number);
    const [ty, tm, td] = todayIso.split('-').map(Number);
    return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  }

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ------------------------------------------------------------------ */
  /* State shape                                                         */
  /* ------------------------------------------------------------------ */

  function createInitialState() {
    return {
      version: SCHEMA_VERSION,

      // 1. User profile
      profile: {
        displayName: '',
        username: '',            // generated from displayName, editable
        heightCm: null,
        weightKg: null,
        units: 'metric',         // 'metric' | 'imperial' (display only, storage stays metric)
        birthDate: null,         // optional "YYYY-MM-DD", gives the age for calorie targets
        age: null,               // older saves and the agent snapshot only; birthDate wins when set
        avatar: { kind: 'initial', color: 'plum', emoji: '', photo: '' },
        activityTier: 1,         // 1 to 4, see ACTIVITY_TIERS
        workoutsLiked: [],       // WORKOUT_PREFERENCES
        occupation: null,        // OCCUPATIONS
        isMom: false,
        sexuallyActive: null,    // optional: true | false | null (prefer not to say)
      },

      // 2. Cycle baseline
      cycle: {
        lastPeriodStart: null,   // "YYYY-MM-DD"
        cycleLength: CYCLE_LIMITS.cycleLength.default,
        periodLength: CYCLE_LIMITS.periodLength.default,
        typicalPain: 1,          // 1 to 10
        typicalFlow: 'medium',   // FLOW
      },

      // 3. Diet and health
      health: {
        goal: 'maintain',        // GOALS
        conditions: [],          // CONDITIONS
        dietStyles: [],          // DIET_STYLES
        allergies: [],           // ALLERGY_PRESETS plus custom strings
      },

      // 4. Daily logs (flat arrays, each entry has id and date)
      logs: {
        meals: [],     // { id, date, meal, name, foodId, quantity, kcal, carbsG, proteinG, fatG }
        workouts: [],  // { id, date, type, durationMin, effort, notes, sets: [{ exercise, sets, reps, loadKg }] }
        tasks: [],     // { id, title, dueAt, type, effort, status, completedAt, logNote, phaseAtDue, source }
        moods: [],     // { id, date, moods: [], note, source }
        periods: [],   // { id, startDate, endDate, flow, pain, notes }
        symptoms: [],  // { id, date, symptoms: [], pain, notes }
      },

      settings: {
        theme: 'light',          // 'light' | 'dark'
        locale: 'en',
        plan: 'free',            // 'free' | 'pro' (UI mirror only, the server decides)
        onboardingStep: 'profile',
        assistantCanUse: { mood: false, pain: false, diet: false, schedule: false },
        assistant: { consent: false }, // agreed to send chats to Petal's online agent (Groq)
        notifications: {
          enabled: false,                         // the person turned reminders on in Petal
          moodReminder: { on: false, time: '20:00' },
          periodAlert: { on: true, daysBefore: 2 },
          taskReminders: { on: false, minutesBefore: 15 },
        },
        signedOut: false,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Validation / normalisation                                          */
  /* ------------------------------------------------------------------ */

  function pickList(values, allowed) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter((v) => allowed.includes(v)))];
  }

  function normalizeProfile(p) {
    const out = Object.assign({}, p);
    if ('displayName' in out) out.displayName = String(out.displayName || '').trim().slice(0, 40);
    if ('username' in out) out.username = String(out.username || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
    if ('heightCm' in out) out.heightCm = out.heightCm == null ? null : clamp(Number(out.heightCm), 100, 230);
    if ('weightKg' in out) out.weightKg = out.weightKg == null ? null : clamp(Number(out.weightKg), 30, 250);
    if ('age' in out) out.age = out.age == null ? null : clamp(toInt(out.age, 30), 12, 100);
    if ('birthDate' in out) {
      const age = ageOn(out.birthDate, toISODate(new Date()));
      out.birthDate = age != null && age >= 12 && age <= 100 ? out.birthDate : null;
    }
    if ('avatar' in out) out.avatar = normalizeAvatar(out.avatar);
    if ('activityTier' in out) out.activityTier = clamp(toInt(out.activityTier, 1), 1, 4);
    if ('workoutsLiked' in out) out.workoutsLiked = pickList(out.workoutsLiked, WORKOUT_PREFERENCES);
    if ('occupation' in out && !OCCUPATIONS.includes(out.occupation)) out.occupation = null;
    if ('isMom' in out) out.isMom = Boolean(out.isMom);
    if ('sexuallyActive' in out && out.sexuallyActive !== null) out.sexuallyActive = Boolean(out.sexuallyActive);
    return out;
  }

  function normalizeCycle(c) {
    const out = Object.assign({}, c);
    const L = CYCLE_LIMITS;
    if ('lastPeriodStart' in out && out.lastPeriodStart != null) out.lastPeriodStart = toISODate(out.lastPeriodStart);
    if ('cycleLength' in out) out.cycleLength = clamp(toInt(out.cycleLength, L.cycleLength.default), L.cycleLength.min, L.cycleLength.max);
    if ('periodLength' in out) out.periodLength = clamp(toInt(out.periodLength, L.periodLength.default), L.periodLength.min, L.periodLength.max);
    if ('typicalPain' in out) out.typicalPain = clamp(toInt(out.typicalPain, 1), L.pain.min, L.pain.max);
    if ('typicalFlow' in out && !FLOW.includes(out.typicalFlow)) out.typicalFlow = 'medium';
    return out;
  }

  function normalizeHealth(h) {
    const out = Object.assign({}, h);
    if ('goal' in out && !GOALS.includes(out.goal)) out.goal = 'maintain';
    if ('conditions' in out) {
      out.conditions = pickList(out.conditions, CONDITIONS);
      if (out.conditions.includes('none')) out.conditions = ['none'];
    }
    if ('dietStyles' in out) {
      out.dietStyles = pickList(out.dietStyles, DIET_STYLES);
      if (out.dietStyles.includes('none')) out.dietStyles = ['none'];
    }
    if ('allergies' in out) {
      // presets plus free text custom entries
      out.allergies = [...new Set((out.allergies || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean))];
    }
    return out;
  }

  // "Sarah" -> "sarah_flow2026"
  function generateUsername(displayName, year) {
    const base = String(displayName || 'petal')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'petal';
    return base + '_flow' + (year || new Date().getFullYear());
  }

  /* ------------------------------------------------------------------ */
  /* Cycle engine                                                        */
  /* ------------------------------------------------------------------ */

  /*
   * Day ranges of each phase for a given cycle (1 based, inclusive).
   *   ovulationDay = cycleLength - 14
   *   menstrual    = 1 .. periodLength
   *   follicular   = periodLength + 1 .. ovulationDay - 1   (may be empty for long periods on short cycles)
   *   ovulation    = ovulationDay
   *   luteal       = ovulationDay + 1 .. cycleLength
   *   fertile      = ovulationDay - 5 .. ovulationDay + 1   (overlay, not a phase)
   * If the period would reach the ovulation day, ovulation is pushed to the day after the period.
   */
  function getPhaseBoundaries(cycleLength, periodLength) {
    const L = clamp(toInt(cycleLength, 28), CYCLE_LIMITS.cycleLength.min, CYCLE_LIMITS.cycleLength.max);
    const P = clamp(toInt(periodLength, 5), CYCLE_LIMITS.periodLength.min, CYCLE_LIMITS.periodLength.max);
    const ovulationDay = Math.max(L - 14, P + 1);
    return {
      cycleLength: L,
      periodLength: P,
      ovulationDay,
      menstrual: { start: 1, end: P },
      follicular: { start: P + 1, end: ovulationDay - 1 }, // empty when start > end
      ovulation: { start: ovulationDay, end: ovulationDay },
      luteal: { start: ovulationDay + 1, end: L },
      fertile: { start: Math.max(1, ovulationDay - 5), end: Math.min(L, ovulationDay + 1) },
    };
  }

  function phaseForCycleDay(cycleDay, bounds) {
    if (cycleDay <= bounds.menstrual.end) return 'menstrual';
    if (cycleDay < bounds.ovulationDay) return 'follicular';
    if (cycleDay === bounds.ovulationDay) return 'ovulation';
    return 'luteal';
  }

  // cycleDay = (daysBetween(lastPeriodStart, date) mod cycleLength) + 1, also valid for past dates.
  function getCycleDay(lastPeriodStart, cycleLength, date) {
    const diff = daysBetween(lastPeriodStart, date);
    return (((diff % cycleLength) + cycleLength) % cycleLength) + 1;
  }

  /*
   * Effective cycle settings. After 3 or more completed cycles in the period log, the typed
   * cycle length is replaced by the rolling mean of the last 6. Also flags irregular cycles.
   */
  function getEffectiveCycle(cycle, periodLogs) {
    const starts = [...new Set((periodLogs || []).map((p) => p.startDate).filter(isISODate))].sort();
    if (cycle.lastPeriodStart && !starts.includes(cycle.lastPeriodStart)) {
      starts.push(cycle.lastPeriodStart);
      starts.sort();
    }
    const lengths = [];
    for (let i = 1; i < starts.length; i++) {
      const len = daysBetween(starts[i - 1], starts[i]);
      if (len >= 15 && len <= 60) lengths.push(len); // ignore obvious logging mistakes
    }
    const recent = lengths.slice(-6);
    const base = {
      lastPeriodStart: starts.length ? starts[starts.length - 1] : cycle.lastPeriodStart,
      cycleLength: cycle.cycleLength,
      periodLength: cycle.periodLength,
      loggedCycles: recent.length,
      spread: 0,
      irregular: false,
      basis: 'Based on your setup answers',
    };
    if (recent.length >= 3) {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const spread = Math.max(...recent) - Math.min(...recent);
      base.cycleLength = clamp(Math.round(mean), CYCLE_LIMITS.cycleLength.min, CYCLE_LIMITS.cycleLength.max);
      base.spread = spread;
      base.irregular = spread > 7;
      base.basis = 'Based on your last ' + recent.length + ' cycles';
    }
    return base;
  }

  /*
   * Phase info for any date. Returns null when the cycle has not been set up yet.
   * `cycle` is state.cycle; pass state.logs.periods to use logged history.
   */
  function getPhaseInfo(cycle, date, periodLogs) {
    if (!cycle || !cycle.lastPeriodStart) return null;
    const eff = getEffectiveCycle(cycle, periodLogs);
    const bounds = getPhaseBoundaries(eff.cycleLength, eff.periodLength);
    const iso = toISODate(date || new Date());
    const cycleDay = getCycleDay(eff.lastPeriodStart, bounds.cycleLength, iso);
    const phase = phaseForCycleDay(cycleDay, bounds);
    const range = bounds[phase];
    const nextPhase = PHASE_ORDER[(PHASE_ORDER.indexOf(phase) + 1) % 4];
    const cycleStart = addDays(iso, -(cycleDay - 1));

    return {
      date: iso,
      cycleDay,
      cycleLength: bounds.cycleLength,
      phase,
      label: PHASES[phase].label,
      dayInPhase: cycleDay - range.start + 1,
      phaseLength: range.end - range.start + 1,
      nextPhase: bounds.follicular.start > bounds.follicular.end && nextPhase === 'follicular' ? 'ovulation' : nextPhase,
      daysUntilNextPhase: range.end - cycleDay + 1,
      isFertile: cycleDay >= bounds.fertile.start && cycleDay <= bounds.fertile.end,
      isOvulationDay: cycleDay === bounds.ovulationDay,
      isLateLuteal: phase === 'luteal' && cycleDay > bounds.cycleLength - NUTRITION_CONFIG.lateLutealDays,
      cycleStart,
      ovulationDate: addDays(cycleStart, bounds.ovulationDay - 1),
      fertileWindow: { start: addDays(cycleStart, bounds.fertile.start - 1), end: addDays(cycleStart, bounds.fertile.end - 1) },
      isPredicted: daysBetween(eff.lastPeriodStart, iso) >= bounds.cycleLength, // beyond the current cycle
      irregular: eff.irregular,
      basis: eff.basis,
      hints: PHASES[phase],
    };
  }

  // Shorthand for the dashboard: "Luteal, day 19".
  function getCurrentPhase(state, now) {
    return getPhaseInfo(state.cycle, today(now), state.logs && state.logs.periods);
  }

  /*
   * Next period as a range (predicted start plus or minus 1 day, wider when cycles vary).
   * Never presented as certain: always carries a basis line.
   */
  function predictNextPeriod(cycle, periodLogs, now) {
    if (!cycle || !cycle.lastPeriodStart) return null;
    const eff = getEffectiveCycle(cycle, periodLogs);
    const t = today(now);
    let start = addDays(eff.lastPeriodStart, eff.cycleLength);
    while (daysBetween(t, start) < 0) start = addDays(start, eff.cycleLength); // late or unlogged periods
    const margin = eff.irregular ? Math.ceil(eff.spread / 2) : eff.spread > 3 ? 2 : 1;
    return {
      predicted: start,
      earliest: addDays(start, -margin),
      latest: addDays(start, margin),
      daysAway: daysBetween(t, start),
      irregular: eff.irregular,
      basis: eff.basis,
      note: eff.irregular
        ? 'Your cycles vary by more than 7 days. Consider talking to a clinician. This is an estimate, not medical advice.'
        : 'This is an estimate, not medical advice.',
    };
  }

  // One entry per day for calendar grids and the phase strip under charts.
  function getPhaseRange(cycle, startDate, days, periodLogs) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(startDate, i);
      const info = getPhaseInfo(cycle, d, periodLogs);
      out.push(info ? { date: d, phase: info.phase, cycleDay: info.cycleDay, isFertile: info.isFertile, isOvulationDay: info.isOvulationDay } : { date: d, phase: null });
    }
    return out;
  }

  // Monday first month grid, padded to whole weeks. month is 1 to 12.
  function getMonthGrid(cycle, year, month, periodLogs) {
    const first = year + '-' + String(month).padStart(2, '0') + '-01';
    const weekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // Mon = 0
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const total = Math.ceil((weekday + daysInMonth) / 7) * 7;
    return getPhaseRange(cycle, addDays(first, -weekday), total, periodLogs).map((d) => Object.assign(d, { inMonth: d.date.slice(0, 7) === first.slice(0, 7) }));
  }

  /* ------------------------------------------------------------------ */
  /* Nutrition                                                           */
  /* ------------------------------------------------------------------ */

  // Mifflin St Jeor (female) x activity tier, adjusted by goal, plus late luteal scaling for Pro.
  function getCalorieTarget(state, now) {
    const { profile, health, settings } = state;
    if (!profile.weightKg || !profile.heightCm) return null;
    const known = ageOn(profile.birthDate, toISODate(now)) || profile.age;
    const age = known || NUTRITION_CONFIG.defaultAge;
    const bmr = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * age - 161;
    const tdee = bmr * ACTIVITY_TIERS[profile.activityTier].factor;
    let kcal = tdee * (1 + NUTRITION_CONFIG.goalAdjust[health.goal]);

    const phase = getCurrentPhase(state, now);
    const scaled = settings.plan === 'pro' && phase && phase.isLateLuteal;
    if (scaled) kcal += NUTRITION_CONFIG.lateLutealKcal;
    kcal = Math.round(kcal / 10) * 10;

    const split = scaled ? NUTRITION_CONFIG.lateLutealMacroSplit : NUTRITION_CONFIG.macroSplit;
    const g = NUTRITION_CONFIG.kcalPerGram;
    return {
      kcal,
      carbsG: Math.round((kcal * split.carbs) / g.carbs),
      proteinG: Math.round((kcal * split.protein) / g.protein),
      fatG: Math.round((kcal * split.fat) / g.fat),
      phaseScaled: scaled,
      micronutrientFocus: phase ? NUTRITION_CONFIG.micronutrientFocus[phase.phase] : [],
      basis: known ? 'Based on your height, weight, age and activity' : 'Based on your height, weight and activity (age assumed 30)',
    };
  }

  // Calorie ring colour stops: green, amber, orange, red (docs/CYCLE_ENGINE.md, Nutrition).
  function ringColor(ratio) {
    if (ratio >= 1) return '#f26b6b';
    if (ratio >= 0.8) return '#f59e42';
    if (ratio >= 0.5) return '#ffd24a';
    return '#8fd694';
  }

  /* ------------------------------------------------------------------ */
  /* Scores                                                              */
  /* ------------------------------------------------------------------ */

  function moodScore(moods) {
    const raw = (moods || []).reduce((sum, m) => sum + (MOODS[m] ? MOODS[m].score : 0), 0);
    return { raw, chart: clamp(raw, -3, 3) };
  }

  function productivityScore(tasks) {
    const done = tasks.filter((t) => t.status === 'done').length;
    const missed = tasks.filter((t) => t.status === 'missed').length;
    return { done, missed, net: done - missed, completionRate: done + missed ? done / (done + missed) : null };
  }

  /* ------------------------------------------------------------------ */
  /* Mood history                                                        */
  /* ------------------------------------------------------------------ */

  // One entry per day: every log on that day counts toward its score.
  function moodByDay(moods, startDate, days) {
    return Array.from({ length: days }, (_, i) => {
      const d = addDays(startDate, i);
      const logs = moods.filter((m) => m.date === d);
      return Object.assign({ date: d, logged: logs.length > 0 }, moodScore(logs.flatMap((m) => m.moods)));
    });
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  // Average daily chart score per month; null for months with no logs.
  function moodByMonth(moods, year) {
    return Array.from({ length: 12 }, (_, i) => {
      const prefix = year + '-' + String(i + 1).padStart(2, '0');
      const dates = [...new Set(moods.filter((m) => m.date.startsWith(prefix)).map((m) => m.date))];
      if (!dates.length) return { month: i + 1, days: 0, average: null };
      const scores = dates.map((d) => moodScore(moods.filter((m) => m.date === d).flatMap((m) => m.moods)).chart);
      return { month: i + 1, days: dates.length, average: round1(scores.reduce((a, b) => a + b, 0) / scores.length) };
    });
  }

  // Average daily score per phase, plus how many cycles the logs span (for the basis line).
  function moodByPhase(cycle, periodLogs, moods) {
    const out = {};
    PHASE_ORDER.forEach((p) => { out[p] = { days: 0, total: 0, average: null }; });
    const dates = [...new Set(moods.map((m) => m.date))];
    const cycles = new Set();
    dates.forEach((d) => {
      const info = getPhaseInfo(cycle, d, periodLogs);
      if (!info) return;
      cycles.add(info.cycleStart);
      const bucket = out[info.phase];
      bucket.days += 1;
      bucket.total += moodScore(moods.filter((m) => m.date === d).flatMap((m) => m.moods)).chart;
    });
    PHASE_ORDER.forEach((p) => { if (out[p].days) out[p].average = round1(out[p].total / out[p].days); });
    return { phases: out, days: dates.length, cycles: cycles.size };
  }

  /* ------------------------------------------------------------------ */
  /* Planner                                                             */
  /* ------------------------------------------------------------------ */

  // Local calendar day a task is due on.
  function taskDate(task) {
    return toISODate(new Date(task.dueAt));
  }

  // Monday of the week containing iso (day number 0 is a Thursday).
  function weekStartOf(iso) {
    return addDays(iso, -((dayNumber(iso) + 3) % 7));
  }

  function productivityByDay(tasks, startDate, days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(startDate, i);
      const dayTasks = tasks.filter((t) => taskDate(t) === d);
      out.push(Object.assign({ date: d, total: dayTasks.length, pending: dayTasks.filter((t) => t.status === 'pending').length }, productivityScore(dayTasks)));
    }
    return out;
  }

  function productivityByMonth(tasks, year) {
    return Array.from({ length: 12 }, (_, i) => {
      const prefix = year + '-' + String(i + 1).padStart(2, '0');
      const monthTasks = tasks.filter((t) => taskDate(t).startsWith(prefix));
      return Object.assign({ month: i + 1, total: monthTasks.length }, productivityScore(monthTasks));
    });
  }

  /*
   * Rule based check on a new task (screens P2 and P3 in docs/SCREENS.md). Returns data only, the UI writes the copy.
   *   peak:    due within a day of ovulation
   *   caution: deep focus work due in the menstrual or luteal phase; suggests the second day
   *            of the next follicular phase
   *   ok:      anything else
   */
  const TIRED_MOODS = ['exhausted', 'anxious', 'irritable'];
  function getTaskAdvice(cycle, periodLogs, task, allTasks, moods, todayIso) {
    const date = taskDate(task);
    const info = getPhaseInfo(cycle, date, periodLogs);
    if (!info) return { kind: 'none', date };

    const weekStart = weekStartOf(date);
    const weekTaskCount = allTasks.filter((t) => {
      if (t.id === task.id) return false;
      const diff = daysBetween(weekStart, taskDate(t));
      return diff >= 0 && diff < 7;
    }).length;
    const moodsToday = (moods || []).filter((m) => m.date === todayIso).flatMap((m) => m.moods);

    let kind = 'ok';
    if (todayIso && daysBetween(todayIso, date) < 0) kind = 'ok'; // no advice on days already gone
    else if (Math.abs(daysBetween(info.ovulationDate, date)) <= 1) kind = 'peak';
    else if (task.effort === 'deep' && (info.phase === 'menstrual' || info.phase === 'luteal')) kind = 'caution';

    let follicularStart = null, suggestedDate = null;
    if (kind === 'caution') {
      const bounds = getPhaseBoundaries(info.cycleLength, cycle.periodLength);
      const nextStart = info.phase === 'menstrual' ? info.cycleStart : addDays(info.cycleStart, info.cycleLength);
      follicularStart = addDays(nextStart, bounds.follicular.start - 1);
      suggestedDate = addDays(follicularStart, 1); // a day of margin, the range is an estimate
    }

    return {
      kind, date, info, weekTaskCount, follicularStart, suggestedDate,
      moodLogged: moodsToday.length > 0,
      tired: moodsToday.some((m) => TIRED_MOODS.includes(m)),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Workouts                                                            */
  /* ------------------------------------------------------------------ */

  // Kept in one place so a trainer can tune it. Intensity runs 1 (gentle) to 5 (peak).
  const WORKOUT_CONFIG = {
    intensityCap: { menstrual: 3, follicular: 4, ovulation: 5, luteal: 4 },
    lateLutealCap: 3,
    loadPercent: { 1: 40, 2: 50, 3: 60, 4: 80, 5: 100 },  // of usual loads, by cap
    runMinutes: { menstrual: [15, 20], follicular: [30, 40], ovulation: [30, 45], luteal: [20, 30] },
    momRunFactor: 0.75,                                    // moms get shorter targets
    painThreshold: 6,                                      // logged pain at or above this lowers the cap
    hardEffort: 8,                                         // effort yesterday at or above this lowers the cap
  };

  /*
   * Today's training plan. Advice only, never a hard block (docs/CYCLE_ENGINE.md, workout caution).
   * Signals from today's logs (tired, pain, a hard session yesterday) each lower the cap by 1.
   */
  function getWorkoutPlan(state, todayIso) {
    const info = getPhaseInfo(state.cycle, todayIso, state.logs.periods);
    if (!info) return null;
    const C = WORKOUT_CONFIG;
    const moods = state.logs.moods.filter((m) => m.date === todayIso).flatMap((m) => m.moods);
    const pains = state.logs.symptoms.filter((s) => s.date === todayIso && s.pain != null).map((s) => s.pain);
    const pain = pains.length ? Math.max(...pains) : null;
    const yesterday = state.logs.workouts.filter((w) => w.date === addDays(todayIso, -1));
    const yesterdayEffort = yesterday.length ? Math.max(...yesterday.map((w) => w.effort)) : null;

    const signals = {
      tired: moods.includes('exhausted'),
      bloated: moods.includes('bloated'),
      pain: pain != null && pain >= C.painThreshold,
      hardYesterday: yesterdayEffort != null && yesterdayEffort >= C.hardEffort,
    };
    let cap = info.isLateLuteal ? C.lateLutealCap : C.intensityCap[info.phase];
    cap -= ['tired', 'pain', 'hardYesterday'].filter((k) => signals[k]).length;
    cap = clamp(cap, 1, 5);

    const peakPhase = info.phase === 'follicular' || info.phase === 'ovulation';
    const calm = !signals.tired && !signals.pain && !signals.hardYesterday;
    const fit = {
      weights: cap >= 4 ? 'ok' : cap === 3 ? 'care' : 'rest',
      pilates: 'ok',
      yoga: 'ok',
      running: peakPhase && calm ? 'ok' : 'easy',
    };
    const base = {
      weights: cap,
      pilates: peakPhase ? 2.5 : 4,
      yoga: info.phase === 'menstrual' ? 4.5 : peakPhase ? 2 : 3.5,
      running: peakPhase && calm ? 4 : 2,
    };
    const liked = { weights: 'weights', pilates: 'pilates', yoga: 'yoga', running: 'running' };
    const types = Object.keys(base)
      .map((key) => ({ key, fit: fit[key], score: base[key] + (state.profile.workoutsLiked.includes(liked[key]) ? 1 : 0) }))
      .sort((a, b) => b.score - a.score);

    let [lo, hi] = C.runMinutes[info.phase];
    if (!calm) hi = Math.min(hi, lo + 10);
    if (state.profile.isMom) { lo = Math.max(10, Math.round((lo * C.momRunFactor) / 5) * 5); hi = Math.max(lo, Math.round((hi * C.momRunFactor) / 5) * 5); }

    return {
      date: todayIso, info, cap, signals, pain, yesterdayEffort,
      moodLogged: moods.length > 0,
      caution: cap <= 3,
      loadPercent: C.loadPercent[cap],
      types,
      run: { minMinutes: lo, targetMinutes: hi, pace: fit.running === 'ok' ? 'steady' : 'easy' },
    };
  }

  // Catalog entries for a location. With no plan (free tier) the full list is returned.
  function exercisesFor(catalog, location, plan) {
    return catalog.filter((e) => e.location === location && (!plan || (e.intensity <= plan.cap && e.phases.includes(plan.info.phase))));
  }

  /* ------------------------------------------------------------------ */
  /* Export and reminders                                                */
  /* ------------------------------------------------------------------ */

  function csvCell(v) {
    let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Text starting with = + - @ runs as a formula in Excel and Sheets (CSV injection), so quote it as text.
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Every log as one CSV table: kind, date, then the union of each kind's own fields.
  function exportCSV(state) {
    const rows = [];
    Object.keys(state.logs).forEach((kind) => state.logs[kind].forEach((e) => rows.push(Object.assign({ kind }, e))));
    const cols = ['kind', 'date', 'startDate', 'dueAt'];
    rows.forEach((r) => Object.keys(r).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
    return [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))).join('\r\n') + '\r\n';
  }

  /*
   * Reminders that are due now. `fired` remembers what was already shown, keyed by reminder,
   * so each fires once: { mood: 'YYYY-MM-DD', period: 'YYYY-MM-DD', tasks: [ids] }.
   */
  function dueReminders(state, nowDate, fired) {
    const n = state.settings.notifications;
    if (!n.enabled) return [];
    const f = fired || {};
    const t = today(nowDate);
    const out = [];
    const hhmm = String(nowDate.getHours()).padStart(2, '0') + ':' + String(nowDate.getMinutes()).padStart(2, '0');
    if (n.moodReminder.on && hhmm >= n.moodReminder.time && f.mood !== t && !state.logs.moods.some((m) => m.date === t)) {
      out.push({ key: 'mood', id: t });
    }
    const next = n.periodAlert.on ? predictNextPeriod(state.cycle, state.logs.periods, nowDate) : null;
    if (next && next.daysAway >= 0 && next.daysAway <= n.periodAlert.daysBefore && f.period !== next.predicted) {
      out.push({ key: 'period', id: next.predicted, earliest: next.earliest, latest: next.latest });
    }
    if (n.taskReminders.on) {
      const soon = nowDate.getTime() + n.taskReminders.minutesBefore * 60000;
      state.logs.tasks.forEach((task) => {
        const due = new Date(task.dueAt).getTime();
        if (task.status === 'pending' && due >= nowDate.getTime() && due <= soon && !(f.tasks || []).includes(task.id)) {
          out.push({ key: 'task', id: task.id, title: task.title, minutes: Math.max(1, Math.round((due - nowDate.getTime()) / 60000)) });
        }
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Assistant: context, tools and validation (no network here)          */
  /* Shared by the app and the server agent (api/agent.js).              */
  /* ------------------------------------------------------------------ */

  // The assistant runs on Petal's server. Nothing is sent before the person agrees (consent).
  const ASSISTANT_DEFAULTS = { consent: false };
  function normalizeAssistant(a) {
    // hostedConsent was the name of the same agreement in the first online version.
    return { consent: Boolean(a && (a.consent === true || a.hostedConsent === true)) };
  }

  /*
   * What the model may see, built only from the toggles in Privacy settings.
   * Cycle day and phase are always included (the assistant cannot work without them).
   * Never names, usernames, emails or ids. Returns the prompt text and the basis labels
   * the UI shows under every answer.
   */
  /*
   * tzOffset: minutes ahead of UTC on the person's phone (the server runs in UTC), so task
   * days and times read the way they see them. Left out in the browser.
   */
  function buildAssistantContext(state, todayIso, tzOffset) {
    const allow = state.settings.assistantCanUse;
    const local = (iso) => {
      const d = new Date(iso);
      if (tzOffset == null) return { date: toISODate(d), time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') };
      const s = new Date(d.getTime() + tzOffset * 60000).toISOString();
      return { date: s.slice(0, 10), time: s.slice(11, 16) };
    };
    const lines = [];
    const basis = [];
    const info = getPhaseInfo(state.cycle, todayIso, state.logs.periods);
    // Weekday names for the coming days, so "on Monday" lands on the right date.
    const weekday = (iso) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(iso + 'T12:00:00Z').getUTCDay()];
    lines.push('Today: ' + weekday(todayIso) + ' ' + todayIso + '. Coming days: ' + [1, 2, 3, 4, 5, 6, 7].map((n) => weekday(addDays(todayIso, n)) + ' ' + addDays(todayIso, n)).join(', ') + '.');
    if (info) {
      lines.push('Cycle day ' + info.cycleDay + ' of about ' + info.cycleLength + ', ' + info.label + ' phase (estimate from the logged period start).');
      const next = predictNextPeriod(state.cycle, state.logs.periods, new Date(todayIso + 'T12:00:00'));
      if (next) lines.push('Next period likely between ' + next.earliest + ' and ' + next.latest + '.');
      basis.push('cycle day ' + info.cycleDay);
    } else {
      lines.push('No cycle data yet.');
    }
    const since = addDays(todayIso, -6);
    if (allow.mood) {
      const recent = state.logs.moods.filter((m) => m.date >= since && m.date <= todayIso);
      lines.push(recent.length ? 'Moods in the last 7 days: ' + recent.map((m) => '[mood ' + m.id + '] ' + m.date + ' ' + m.moods.join(', ') + (m.note ? ' (note: ' + m.note.slice(0, 200) + ')' : '')).join('; ') + '.' : 'No moods logged in the last 7 days.');
      basis.push(recent.some((m) => m.date === todayIso) ? 'mood logged today' : 'recent moods');
    }
    if (allow.pain) {
      lines.push('Typical period pain ' + state.cycle.typicalPain + ' of 10, typical flow ' + state.cycle.typicalFlow + '.');
      const sym = state.logs.symptoms.filter((s) => s.date >= since && s.date <= todayIso);
      if (sym.length) lines.push('Symptoms in the last 7 days: ' + sym.map((s) => s.date + ' ' + (s.symptoms || []).join(', ') + (s.pain ? ' pain ' + s.pain : '')).join('; ') + '.');
      basis.push('pain baseline');
    }
    if (allow.diet) {
      const h = state.health;
      lines.push('Goal: ' + h.goal + '. Diet style: ' + (h.dietStyles.join(', ') || 'none set') + '. Allergies or avoids: ' + (h.allergies.join(', ') || 'none') + '. Conditions: ' + (h.conditions.join(', ') || 'none') + '.');
      const meals = state.logs.meals.filter((m) => m.date === todayIso);
      const p = state.profile;
      const age = p.age || ageOn(p.birthDate, todayIso);
      if (p.weightKg || p.heightCm) lines.push('Body: ' + [p.heightCm ? Math.round(p.heightCm) + ' cm' : '', p.weightKg ? Math.round(p.weightKg * 10) / 10 + ' kg' : '', age ? 'age ' + age : ''].filter(Boolean).join(', ') + '.');
      if (meals.length) lines.push('Eaten today: ' + meals.map((m) => '[meal ' + m.id + '] ' + m.meal + ' ' + m.name.slice(0, 60) + ' ' + Math.round(m.kcal) + ' kcal').join('; ') + '.');
      const limits = h.dietStyles.filter((d) => d !== 'none').concat(h.allergies.map((x) => x + ' free')).slice(0, 2);
      basis.push(limits.length ? limits.join(' and ') + ' diet' : 'no diet limits');
    }
    if (allow.schedule) {
      const p = state.profile;
      if (p.occupation) lines.push('Occupation: ' + p.occupation + (p.isMom ? ', a mom' : '') + '.');
      const end = addDays(todayIso, 6);
      const row = (t) => { const l = local(t.dueAt); return '[task ' + t.id + '] ' + l.date + ' ' + l.time + ' ' + t.title.slice(0, 80) + ' (' + t.type + ', ' + t.effort + ' effort, ' + t.status + ')'; };
      const tasks = state.logs.tasks.filter((t) => { const d = local(t.dueAt).date; return d >= since && d <= end && (t.status !== 'done' || d === todayIso); })
        .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1)).slice(0, 40);
      lines.push(tasks.length ? 'Tasks from the last 7 days to the next 7 (open, missed, and done today): ' + tasks.map(row).join('; ') + '.' : 'No tasks in the last or next 7 days.');
      const w = state.logs.workouts.filter((x) => x.date >= since);
      if (w.length) lines.push('Workouts in the last 7 days: ' + w.map((x) => '[workout ' + x.id + '] ' + x.date + ' ' + x.type + ' ' + x.durationMin + ' min effort ' + x.effort).join('; ') + '.');
      basis.push('your schedule');
    }
    return { text: lines.join('\n'), basis, phase: info ? info.phase : null, cycleDay: info ? info.cycleDay : null };
  }

  // Which setup answers are filled in. Sent in setup mode as yes or no only, never the values.
  function setupStatus(state) {
    const p = state.profile;
    const c = state.cycle;
    const h = state.health;
    return {
      name: Boolean(p.displayName), lastPeriodStart: isISODate(c.lastPeriodStart), bodyAndGoal: Boolean(p.heightCm && p.weightKg),
      diet: h.dietStyles.length > 0 || h.allergies.length > 0, activity: p.workoutsLiked.length > 0, occupation: Boolean(p.occupation),
    };
  }

  /*
   * The data the app sends to the agent: only what Privacy settings allow, in the same
   * shape as the state, so the server can run it through migrate() again.
   * mode 'setup' adds which setup answers are filled in.
   */
  function assistantSnapshot(state, todayIso, mode) {
    const allow = state.settings.assistantCanUse;
    const p = state.profile;
    const c = state.cycle;
    const after = (days) => (d) => d >= addDays(todayIso, days);
    const snap = {
      settings: { assistantCanUse: Object.assign({}, allow) },
      cycle: { lastPeriodStart: c.lastPeriodStart, cycleLength: c.cycleLength, periodLength: c.periodLength },
      profile: {}, health: {},
      logs: { periods: state.logs.periods.slice(-12) },
    };
    if (allow.pain) {
      Object.assign(snap.cycle, { typicalPain: c.typicalPain, typicalFlow: c.typicalFlow });
      snap.logs.symptoms = state.logs.symptoms.filter((s) => after(-30)(s.date));
    }
    if (allow.mood) snap.logs.moods = state.logs.moods.filter((m) => after(-30)(m.date));
    if (allow.diet) {
      snap.health = Object.assign({}, state.health);
      // An age in whole years is enough for calorie targets, so the date of birth stays on the phone.
      Object.assign(snap.profile, { heightCm: p.heightCm, weightKg: p.weightKg, age: ageOn(p.birthDate, todayIso) || p.age, activityTier: p.activityTier });
      snap.logs.meals = state.logs.meals.filter((m) => after(-7)(m.date));
    }
    if (allow.schedule) {
      Object.assign(snap.profile, { occupation: p.occupation, isMom: p.isMom, workoutsLiked: p.workoutsLiked });
      snap.logs.tasks = state.logs.tasks.filter((t) => after(-7)(taskDate(t)) && taskDate(t) <= addDays(todayIso, 30)).slice(0, 60);
      snap.logs.workouts = state.logs.workouts.filter((w) => after(-14)(w.date));
    }
    if (mode === 'setup') snap.setup = setupStatus(state);
    return snap;
  }

  const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required: required || [] } } });
  const date = { type: 'string', description: 'YYYY-MM-DD' };
  const listOf = (values) => ({ type: 'array', items: { type: 'string', enum: values } });

  // Read tools run on the server against the person's shared data. Action tools come back to
  // the app, which shows each one and saves it only when the person taps Save.
  const AGENT_TOOLS = {
    get_phase: { kind: 'read', def: fn('get_phase', 'Estimated cycle phase and cycle day for a date.', { date }, ['date']) },
    get_cycle_overview: { kind: 'read', def: fn('get_cycle_overview', 'Today\'s phase, the likely next period range, the fertile window estimate and what the estimate is based on.', {}) },
    get_workout_plan: { kind: 'read', def: fn('get_workout_plan', 'Today\'s training plan: intensity cap 1 to 5, suggested load, workout types ranked for the phase, running minutes.', {}) },
    get_calorie_target: { kind: 'read', def: fn('get_calorie_target', 'Today\'s calorie and macro target. Needs diet data to be shared.', {}) },
    update_profile: { kind: 'action', def: fn('update_profile', 'Propose changes to the profile. Only include fields the person told you.', {
      displayName: { type: 'string', description: 'What to call them' }, birthDate: { type: 'string', description: 'Date of birth, YYYY-MM-DD. Ask for the full date, never just the age.' },
      heightCm: { type: 'number' }, weightKg: { type: 'number', description: 'Current weight in kg. Use this when they tell you a new weight.' },
      activityTier: { type: 'integer', description: '1 sedentary, 2 lightly active, 3 moderately active, 4 very active' }, occupation: { type: 'string', enum: OCCUPATIONS },
      isMom: { type: 'boolean' }, workoutsLiked: listOf(WORKOUT_PREFERENCES) }) },
    update_cycle: { kind: 'action', def: fn('update_cycle', 'Propose changes to the cycle baseline. Only include fields the person told you.', {
      lastPeriodStart: Object.assign({ description: 'First day of the last period, YYYY-MM-DD' }, { type: 'string' }), cycleLength: { type: 'integer', description: '21 to 45 days' },
      periodLength: { type: 'integer', description: '2 to 10 days' }, typicalPain: { type: 'integer', description: '1 to 10' }, typicalFlow: { type: 'string', enum: FLOW } }) },
    update_health: { kind: 'action', def: fn('update_health', 'Propose diet and health answers. Lists replace the current list, so include everything the person wants.', {
      goal: { type: 'string', enum: GOALS }, conditions: listOf(CONDITIONS), dietStyles: listOf(DIET_STYLES), allergies: { type: 'array', items: { type: 'string' }, description: 'Use gluten, dairy, nuts, soy, shellfish, or a short custom word' } }) },
    add_task: { kind: 'action', def: fn('add_task', 'Propose a task or event for the planner, such as a meeting, a study block, a workout slot or a meal prep slot.', { title: { type: 'string' }, date, time: { type: 'string', description: 'HH:MM, 24 hour' }, type: { type: 'string', enum: TASK_TYPES }, effort: { type: 'string', enum: TASK_EFFORT } }, ['title', 'date']) },
    update_task: { kind: 'action', target: 'tasks', def: fn('update_task', 'Propose changing an existing task: move it to another day or time, rename it, or change its type or effort. Use the id from [task id] in the data. Only include what changes.', { id: { type: 'string' }, title: { type: 'string' }, date, time: { type: 'string', description: 'HH:MM, 24 hour' }, type: { type: 'string', enum: TASK_TYPES }, effort: { type: 'string', enum: TASK_EFFORT } }, ['id']) },
    complete_task: { kind: 'action', target: 'tasks', def: fn('complete_task', 'Propose marking an existing task as done.', { id: { type: 'string' } }, ['id']) },
    remove_task: { kind: 'action', target: 'tasks', def: fn('remove_task', 'Propose deleting an existing task. Only when they ask to remove or cancel it.', { id: { type: 'string' } }, ['id']) },
    remove_log: { kind: 'action', def: fn('remove_log', 'Propose deleting a logged meal, workout or mood they say is wrong. Use the id from [meal id], [workout id] or [mood id] in the data.', { kind: { type: 'string', enum: ['meal', 'workout', 'mood'] }, id: { type: 'string' } }, ['kind', 'id']) },
    log_mood: { kind: 'action', def: fn('log_mood', 'Propose logging moods for today.', { moods: listOf(Object.keys(MOODS)), note: { type: 'string' } }, ['moods']) },
    log_meal: { kind: 'action', def: fn('log_meal', 'Propose logging a meal. Estimate calories and macros only if the person asks you to.', { meal: { type: 'string', enum: MEALS }, name: { type: 'string' }, date, kcal: { type: 'number' }, carbsG: { type: 'number' }, proteinG: { type: 'number' }, fatG: { type: 'number' } }, ['meal', 'name']) },
    log_workout: { kind: 'action', def: fn('log_workout', 'Propose logging a finished workout.', { type: { type: 'string', enum: WORKOUT_TYPES }, durationMin: { type: 'integer' }, effort: { type: 'integer', description: '1 to 10' }, date }, ['type', 'durationMin']) },
    log_period: { kind: 'action', def: fn('log_period', 'Propose logging a period start.', { startDate: date, endDate: date, flow: { type: 'string', enum: FLOW }, pain: { type: 'integer', description: '1 to 10' } }, ['startDate']) },
    finish_setup: { kind: 'action', def: fn('finish_setup', 'Propose finishing setup. Only when the name and last period start are saved.', {}) },
  };
  // Tools offered in each mode. Setup cannot touch tasks or logs, and chat cannot finish setup.
  const AGENT_MODES = {
    chat: ['get_phase', 'get_cycle_overview', 'get_workout_plan', 'get_calorie_target', 'update_profile', 'update_cycle', 'update_health', 'add_task', 'update_task', 'complete_task', 'remove_task', 'remove_log', 'log_mood', 'log_meal', 'log_workout', 'log_period'],
    setup: ['get_cycle_overview', 'update_profile', 'update_cycle', 'update_health', 'finish_setup'],
    // Petal Lens (api/lens.js): one photo of a meal or a workout. It can only propose logs.
    photo: ['get_cycle_overview', 'get_workout_plan', 'get_calorie_target', 'log_meal', 'log_workout'],
  };

  /*
   * Checks a tool call from the model before anything runs. Model output is untrusted:
   * unknown tools, bad dates and out of range values are refused, never coerced into a write.
   * -> { ok: true, name, args, write } or { ok: false, error }
   */
  function validateToolCall(name, rawArgs, todayIso) {
    let a = rawArgs;
    if (typeof a === 'string') { try { a = safeParse(a || '{}'); } catch (e) { return { ok: false, error: 'Arguments are not valid JSON.' }; } }
    if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: 'Arguments must be an object.' };
    const tool = Object.prototype.hasOwnProperty.call(AGENT_TOOLS, name) ? AGENT_TOOLS[name] : null;
    if (!tool) return { ok: false, error: 'Unknown tool: ' + String(name).slice(0, 40) };
    const errors = [];
    const out = {};
    const has = (k) => a[k] !== undefined && a[k] !== null && a[k] !== '';
    const text = (k, max, required) => {
      if (!has(k)) { if (required) errors.push(k + ' is required.'); return; }
      const v = String(a[k]).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
      if (!v) errors.push(k + ' is required.'); else out[k] = v;
    };
    const number = (k, min, max, int, required) => {
      if (!has(k)) { if (required) errors.push(k + ' is required.'); return; }
      const n = Number(a[k]);
      if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) errors.push(k + ' must be ' + (int ? 'a whole number ' : '') + 'from ' + min + ' to ' + max + '.');
      else out[k] = n;
    };
    const oneOf = (k, values, required) => {
      if (!has(k)) { if (required) errors.push(k + ' is required.'); return; }
      if (!values.includes(a[k])) errors.push(k + ' must be one of: ' + values.join(', ') + '.'); else out[k] = a[k];
    };
    const list = (k, values) => {
      if (!has(k)) return;
      if (!Array.isArray(a[k]) || a[k].some((v) => !values.includes(v))) errors.push(k + ' must only use: ' + values.join(', ') + '.');
      else out[k] = [...new Set(a[k])];
    };
    const day = (k, from, to, required) => {
      if (!has(k)) { if (required) errors.push(k + ' is required.'); return; }
      if (!isISODate(a[k]) || a[k] < addDays(todayIso, from) || a[k] > addDays(todayIso, to)) errors.push(k + ' must be YYYY-MM-DD between ' + addDays(todayIso, from) + ' and ' + addDays(todayIso, to) + '.');
      else out[k] = a[k];
    };
    const id = (k) => { if (typeof a[k] !== 'string' || !/^[\w-]{1,64}$/.test(a[k])) errors.push(k + ' must be an id from the data.'); else out[k] = a[k]; };
    const L = CYCLE_LIMITS;
    switch (name) {
      case 'get_phase': day('date', -366, 366, true); break;
      case 'get_cycle_overview': case 'get_workout_plan': case 'get_calorie_target': case 'finish_setup': break;
      case 'update_profile':
        text('displayName', 40); number('heightCm', 100, 230); number('weightKg', 30, 250);
        if (has('birthDate')) {
          const age = ageOn(a.birthDate, todayIso);
          if (age == null || age < 12 || age > 100) errors.push('birthDate must be YYYY-MM-DD, for someone aged 12 to 100.'); else out.birthDate = a.birthDate;
        }
        number('activityTier', 1, 4, true); oneOf('occupation', OCCUPATIONS); list('workoutsLiked', WORKOUT_PREFERENCES);
        if (has('isMom')) { if (typeof a.isMom !== 'boolean') errors.push('isMom must be true or false.'); else out.isMom = a.isMom; }
        break;
      case 'update_cycle':
        day('lastPeriodStart', -120, 0); number('cycleLength', L.cycleLength.min, L.cycleLength.max, true);
        number('periodLength', L.periodLength.min, L.periodLength.max, true); number('typicalPain', 1, 10, true); oneOf('typicalFlow', FLOW);
        break;
      case 'update_health':
        oneOf('goal', GOALS); list('conditions', CONDITIONS); list('dietStyles', DIET_STYLES);
        if (has('allergies')) {
          if (!Array.isArray(a.allergies) || a.allergies.length > 10) errors.push('allergies must be a list of up to 10 short words.');
          else out.allergies = [...new Set(a.allergies.map((x) => String(x).replace(/[^\p{L}\p{N} -]/gu, '').trim().toLowerCase().slice(0, 40)).filter(Boolean))];
        }
        break;
      case 'add_task':
        text('title', 120, true); day('date', 0, 366, true);
        out.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(a.time || '') ? a.time : '09:00';
        out.type = TASK_TYPES.includes(a.type) ? a.type : 'work';
        out.effort = TASK_EFFORT.includes(a.effort) ? a.effort : 'medium';
        break;
      case 'update_task':
        id('id'); text('title', 120); day('date', -7, 366);
        if (has('time')) { if (!HHMM_RE.test(a.time)) errors.push('time must be HH:MM, 24 hour.'); else out.time = a.time; }
        oneOf('type', TASK_TYPES); oneOf('effort', TASK_EFFORT);
        if (!errors.length && Object.keys(out).length < 2) errors.push('Say what to change: title, date, time, type or effort.');
        break;
      case 'complete_task': case 'remove_task': id('id'); break;
      case 'remove_log': oneOf('kind', ['meal', 'workout', 'mood'], true); id('id'); break;
      case 'log_mood':
        out.moods = pickList(a.moods, Object.keys(MOODS));
        if (!out.moods.length) errors.push('moods must use: ' + Object.keys(MOODS).join(', ') + '.');
        out.note = String(a.note || '').slice(0, 500);
        break;
      case 'log_meal':
        oneOf('meal', MEALS, true); text('name', 120, true); day('date', -30, 0);
        number('kcal', 0, 5000); number('carbsG', 0, 800); number('proteinG', 0, 500); number('fatG', 0, 400);
        if (!out.date) out.date = todayIso;
        break;
      case 'log_workout':
        oneOf('type', WORKOUT_TYPES, true); number('durationMin', 1, 600, true, true); number('effort', 1, 10, true); day('date', -30, 0);
        if (!out.date) out.date = todayIso;
        if (!out.effort) out.effort = 5;
        break;
      case 'log_period':
        day('startDate', -120, 0, true); oneOf('flow', FLOW); number('pain', 1, 10, true);
        if (has('endDate')) {
          if (!out.startDate || !isISODate(a.endDate) || a.endDate < out.startDate || a.endDate > addDays(out.startDate, 14)) errors.push('endDate must be within 14 days after startDate.');
          else out.endDate = a.endDate;
        }
        break;
    }
    if (errors.length) return { ok: false, error: errors.join(' ') };
    if (tool.kind === 'action' && !['finish_setup', 'log_mood'].includes(name) && !Object.keys(out).length) return { ok: false, error: 'Nothing to change.' };
    return { ok: true, name, args: out, write: tool.kind === 'action' };
  }

  /*
   * For tools that change an existing entry: the entry it names, or null when there is none.
   * The server checks this against the shared data and the app checks it again before saving.
   */
  const LOG_KIND = { meal: 'meals', workout: 'workouts', mood: 'moods' };
  function findTarget(name, args, state) {
    const kind = name === 'remove_log' ? LOG_KIND[args.kind] : AGENT_TOOLS[name] && AGENT_TOOLS[name].target;
    if (!kind) return null;
    return (state.logs[kind] || []).find((e) => e.id === args.id) || null;
  }
  const targetsEntry = (name) => name === 'remove_log' || Boolean(AGENT_TOOLS[name] && AGENT_TOOLS[name].target);

  // Runs a read tool on (already sanitised) state. Pure, so the server and tests share it.
  function runReadTool(name, args, state, todayIso) {
    const at = new Date(todayIso + 'T12:00:00');
    const info = getPhaseInfo(state.cycle, todayIso, state.logs.periods);
    if (!info) return { error: 'No cycle data yet. Ask for the first day of the last period.' };
    if (name === 'get_phase') {
      const p = getPhaseInfo(state.cycle, args.date, state.logs.periods);
      return { date: args.date, phase: p.label, cycleDay: p.cycleDay, estimate: true };
    }
    if (name === 'get_cycle_overview') {
      const next = predictNextPeriod(state.cycle, state.logs.periods, at);
      return { today: todayIso, phase: info.label, cycleDay: info.cycleDay, cycleLength: info.cycleLength, nextPeriod: next && { earliest: next.earliest, latest: next.latest },
        fertileWindowEstimate: info.fertileWindow, basis: next ? next.basis : '', note: next && next.note ? next.note : undefined };
    }
    if (name === 'get_workout_plan') {
      const plan = getWorkoutPlan(state, todayIso);
      return { phase: plan.info.label, intensityCap: plan.cap, caution: plan.caution, suggestedLoadPercent: plan.loadPercent, signals: plan.signals,
        typesBestFirst: plan.types.map((t) => t.key + ' (' + t.fit + ')'), runMinutes: plan.run.minMinutes + ' to ' + plan.run.targetMinutes + ', ' + plan.run.pace + ' pace' };
    }
    if (name === 'get_calorie_target') {
      if (!state.settings.assistantCanUse.diet) return { error: 'Diet data is not shared. The person can allow it in Privacy settings.' };
      const t = getCalorieTarget(state, at);
      return t ? { kcal: t.kcal, carbsG: t.carbsG, proteinG: t.proteinG, fatG: t.fatG, micronutrientFocus: t.micronutrientFocus, basis: t.basis } : { error: 'Height and weight are needed first.' };
    }
    return { error: 'Not a read tool.' };
  }

  /* ------------------------------------------------------------------ */
  /* Entitlements (UI mirror only, the server must enforce the same)     */
  /* ------------------------------------------------------------------ */

  // The assistant is free for everyone while Petal is being tested.
  const PRO_FEATURES = ['taskCheck', 'productivityTrends', 'phaseScaling', 'phaseWorkouts', 'moodPatterns'];
  function can(state, feature) {
    return !PRO_FEATURES.includes(feature) || state.settings.plan === 'pro';
  }

  /* ------------------------------------------------------------------ */
  /* Store                                                               */
  /* ------------------------------------------------------------------ */

  function memoryStorage() {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  }

  function defaultStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('__petal_probe', '1');
        localStorage.removeItem('__petal_probe');
        return localStorage;
      }
    } catch (e) { /* private mode or blocked storage */ }
    return memoryStorage();
  }

  /* ------------------------------------------------------------------ */
  /* Setup progress                                                      */
  /* ------------------------------------------------------------------ */

  // Setup is done only when the answers the app cannot work without are in.
  function setupComplete(state) {
    return Boolean(state.profile.displayName && isISODate(state.cycle.lastPeriodStart));
  }

  // The furthest setup step (1 to 7) the person may open. Typing a later step into the URL
  // must not skip the steps that collect the name (1) and the last period (2).
  function setupStepAllowed(state) {
    const s = state.settings.onboardingStep;
    let reached = s === 'done' ? 7 : /^step[1-7]$/.test(s) ? Number(s.slice(4)) : 1;
    if (!state.profile.displayName) reached = 1;
    else if (!isISODate(state.cycle.lastPeriodStart)) reached = Math.min(reached, 2);
    return reached;
  }

  // JSON.parse that drops keys able to reach Object.prototype (imports and storage are untrusted).
  function safeParse(text) {
    return JSON.parse(text, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v));
  }

  const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  const nonNeg = (v) => Math.max(0, Number(v) || 0);
  // Ids end up in data attributes and selectors, so only letters, digits, _ and - are kept.
  const safeId = (v) => (/^[\w-]{1,64}$/.test(v) ? v : uid());

  // Every saved or imported log entry goes through here, so rendering can trust types and lengths.
  const LOG_SANITIZERS = {
    meals: (e) => (MEALS.includes(e.meal) && isISODate(e.date) ? { id: safeId(e.id), date: e.date, meal: e.meal, name: str(e.name, 120), foodId: e.foodId == null ? null : str(e.foodId, 64), quantity: nonNeg(e.quantity), kcal: nonNeg(e.kcal), carbsG: nonNeg(e.carbsG), proteinG: nonNeg(e.proteinG), fatG: nonNeg(e.fatG) } : null),
    workouts: (e) => (WORKOUT_TYPES.includes(e.type) && isISODate(e.date) ? { id: safeId(e.id), date: e.date, type: e.type, durationMin: Math.max(0, toInt(e.durationMin, 0)), effort: clamp(toInt(e.effort, 5), 1, 10), notes: str(e.notes, 1000),
      sets: Array.isArray(e.sets) ? e.sets.slice(0, 50).map((s) => ({ exercise: str(s && s.exercise, 64), sets: s && s.sets != null ? toInt(s.sets, null) : null, reps: s && s.reps != null ? toInt(s.reps, null) : null, loadKg: s && s.loadKg != null ? nonNeg(s.loadKg) : null })) : [] } : null),
    tasks: (e) => {
      const due = new Date(e.dueAt);
      if (Number.isNaN(due.getTime()) || !TASK_TYPES.includes(e.type) || !TASK_EFFORT.includes(e.effort)) return null;
      return { id: safeId(e.id), title: str(e.title, 200), dueAt: due.toISOString(), type: e.type, effort: e.effort, note: str(e.note, 1000), status: TASK_STATUS.includes(e.status) ? e.status : 'pending',
        completedAt: e.completedAt && !Number.isNaN(new Date(e.completedAt).getTime()) ? new Date(e.completedAt).toISOString() : null, logNote: str(e.logNote, 1000), phaseAtDue: PHASE_ORDER.includes(e.phaseAtDue) ? e.phaseAtDue : null, source: e.source === 'assistant' ? 'assistant' : 'user' };
    },
    moods: (e) => (isISODate(e.date) ? { id: safeId(e.id), date: e.date, moods: pickList(e.moods, Object.keys(MOODS)), note: str(e.note, 1000), source: e.source === 'assistant' ? 'assistant' : 'user' } : null),
    periods: (e) => (isISODate(e.startDate) ? { id: safeId(e.id), startDate: e.startDate, endDate: isISODate(e.endDate) ? e.endDate : null, flow: FLOW.includes(e.flow) ? e.flow : 'medium', pain: e.pain == null ? null : clamp(toInt(e.pain, 1), 1, 10), notes: str(e.notes, 1000) } : null),
    symptoms: (e) => (isISODate(e.date) ? { id: safeId(e.id), date: e.date, symptoms: Array.isArray(e.symptoms) ? e.symptoms.slice(0, 20).map((x) => str(x, 40)) : [], pain: e.pain == null ? null : clamp(toInt(e.pain, 1), 1, 10), notes: str(e.notes, 1000) } : null),
  };

  function normalizeSettings(s, base) {
    const out = Object.assign({}, base, s);
    out.theme = out.theme === 'dark' ? 'dark' : 'light';
    out.locale = /^[a-z]{2}(-[A-Z]{2})?$/.test(out.locale) ? out.locale : 'en';
    out.plan = out.plan === 'pro' ? 'pro' : 'free';
    out.onboardingStep = /^(profile|step[1-7]|done)$/.test(out.onboardingStep) ? out.onboardingStep : base.onboardingStep;
    out.signedOut = out.signedOut === true;
    const a = Object.assign({}, base.assistantCanUse, s && s.assistantCanUse);
    out.assistantCanUse = { mood: a.mood === true, pain: a.pain === true, diet: a.diet === true, schedule: a.schedule === true };
    out.assistant = normalizeAssistant(s && s.assistant);
    const bn = base.notifications;
    const n = Object.assign({}, bn, s && s.notifications);
    const mr = Object.assign({}, bn.moodReminder, n.moodReminder);
    const pa = Object.assign({}, bn.periodAlert, n.periodAlert);
    const tr = Object.assign({}, bn.taskReminders, n.taskReminders);
    out.notifications = {
      enabled: n.enabled === true,
      moodReminder: { on: mr.on === true, time: HHMM_RE.test(mr.time) ? mr.time : bn.moodReminder.time },
      periodAlert: { on: pa.on !== false, daysBefore: clamp(toInt(pa.daysBefore, 2), 0, 7) },
      taskReminders: { on: tr.on === true, minutesBefore: clamp(toInt(tr.minutesBefore, 15), 5, 120) },
    };
    return out;
  }

  // Fills any missing keys from the default shape so older saves keep working, and
  // validates everything on the way in: storage and imported files are untrusted input.
  function migrate(saved) {
    const base = createInitialState();
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base;
    const out = Object.assign({}, base, { version: SCHEMA_VERSION });
    out.profile = normalizeProfile(Object.assign({}, base.profile, saved.profile));
    const cycle = Object.assign({}, base.cycle, saved.cycle);
    if (!isISODate(cycle.lastPeriodStart)) cycle.lastPeriodStart = null;
    out.cycle = normalizeCycle(cycle);
    const health = Object.assign({}, base.health, saved.health);
    if (!Array.isArray(health.allergies)) health.allergies = [];
    out.health = normalizeHealth(health);
    out.health.allergies = out.health.allergies.slice(0, 30).map((x) => x.slice(0, 40));
    out.settings = normalizeSettings(saved.settings, base.settings);
    if (out.settings.onboardingStep === 'done' && !setupComplete(out)) out.settings.onboardingStep = 'profile';
    out.logs = Object.assign({}, base.logs);
    for (const key of Object.keys(base.logs)) {
      const list = saved.logs && Array.isArray(saved.logs[key]) ? saved.logs[key] : [];
      out.logs[key] = list.filter((e) => e && typeof e === 'object').map(LOG_SANITIZERS[key]).filter(Boolean);
    }
    return out;
  }

  /*
   * createStore({ storage, now }) -> store
   *   storage: anything with getItem/setItem/removeItem (defaults to localStorage, falls back to memory)
   *   now:     function returning a Date, injectable for tests
   */
  function createStore(options) {
    const opts = options || {};
    const storage = opts.storage || defaultStorage();
    const key = opts.storageKey || STORAGE_KEY;
    const now = opts.now || (() => new Date());
    const listeners = new Set();

    let state;
    try { state = migrate(safeParse(storage.getItem(key))); } catch (e) { state = createInitialState(); }

    function persist() {
      try { storage.setItem(key, JSON.stringify(state)); } catch (e) { /* quota or blocked */ }
    }

    function set(next) {
      state = next;
      persist();
      listeners.forEach((fn) => fn(state));
      return state;
    }

    function patchSection(section, patch) {
      return set(Object.assign({}, state, { [section]: Object.assign({}, state[section], patch) }));
    }

    function addLog(kind, entry) {
      const item = Object.assign({ id: uid() }, entry);
      set(Object.assign({}, state, { logs: Object.assign({}, state.logs, { [kind]: state.logs[kind].concat(item) }) }));
      return item;
    }

    function updateLog(kind, id, patch) {
      set(Object.assign({}, state, {
        logs: Object.assign({}, state.logs, { [kind]: state.logs[kind].map((e) => (e.id === id ? Object.assign({}, e, patch) : e)) }),
      }));
    }

    function phaseAt(date) {
      const info = getPhaseInfo(state.cycle, date, state.logs.periods);
      return info ? info.phase : null;
    }

    const actions = {
      /* profile, cycle, health, settings */
      updateProfile(patch) {
        const p = normalizeProfile(patch);
        if (p.displayName && !state.profile.username && !('username' in p)) p.username = generateUsername(p.displayName, now().getFullYear());
        return patchSection('profile', p);
      },
      updateCycle(patch) { return patchSection('cycle', normalizeCycle(patch)); },
      updateHealth(patch) { return patchSection('health', normalizeHealth(patch)); },
      updateSettings(patch) { return patchSection('settings', patch); },
      // Moves setup forward to the step after `step`, never backwards, never past what is answered.
      advanceSetup(step) {
        if (state.settings.onboardingStep === 'done') return state;
        const next = Math.min(Math.max(setupStepAllowed(state), clamp(toInt(step, 1), 1, 6) + 1), 7);
        if (next === 2 && !state.profile.displayName) return state;
        if (next >= 3 && !setupComplete(state)) return state;
        return patchSection('settings', { onboardingStep: 'step' + next });
      },
      // Finishes setup only when the required answers are in. Returns true when done.
      completeSetup() {
        if (!setupComplete(state)) return false;
        patchSection('settings', { onboardingStep: 'done' });
        return true;
      },

      /* daily logs */
      logMeal({ date, meal, name, foodId = null, quantity = 1, kcal = 0, carbsG = 0, proteinG = 0, fatG = 0 }) {
        if (!MEALS.includes(meal)) throw new Error('Unknown meal: ' + meal);
        const n = (v) => Math.max(0, Number(v) || 0);
        return addLog('meals', { date: toISODate(date || now()), meal, name: String(name || ''), foodId, quantity: n(quantity), kcal: n(kcal), carbsG: n(carbsG), proteinG: n(proteinG), fatG: n(fatG) });
      },
      logWorkout({ date, type, durationMin = 0, effort = 5, notes = '', sets = [] }) {
        if (!WORKOUT_TYPES.includes(type)) throw new Error('Unknown workout type: ' + type);
        return addLog('workouts', { date: toISODate(date || now()), type, durationMin: Math.max(0, toInt(durationMin, 0)), effort: clamp(toInt(effort, 5), 1, 10), notes: String(notes), sets });
      },
      logMood({ date, moods = [], note = '', source = 'user' }) {
        const picked = pickList(moods, Object.keys(MOODS));
        return addLog('moods', { date: toISODate(date || now()), moods: picked, note: String(note), source: source === 'assistant' ? 'assistant' : 'user' });
      },
      logSymptoms({ date, symptoms = [], pain = null, notes = '' }) {
        return addLog('symptoms', { date: toISODate(date || now()), symptoms, pain: pain == null ? null : clamp(toInt(pain, 1), 1, 10), notes: String(notes) });
      },
      // Logging a period start also moves cycle.lastPeriodStart forward when it is the newest.
      logPeriod({ startDate, endDate = null, flow = 'medium', pain = null, notes = '' }) {
        const start = toISODate(startDate);
        const item = addLog('periods', { startDate: start, endDate: endDate ? toISODate(endDate) : null, flow: FLOW.includes(flow) ? flow : 'medium', pain, notes });
        if (!state.cycle.lastPeriodStart || start > state.cycle.lastPeriodStart) patchSection('cycle', { lastPeriodStart: start });
        return item;
      },

      /* work events and tasks */
      // source records who created it: 'user', or 'assistant' after the person confirmed a proposal.
      addTask({ title, dueAt, type = 'work', effort = 'medium', note = '', source = 'user' }) {
        if (!TASK_TYPES.includes(type)) throw new Error('Unknown task type: ' + type);
        if (!TASK_EFFORT.includes(effort)) throw new Error('Unknown effort: ' + effort);
        const due = dueAt ? new Date(dueAt) : now();
        return addLog('tasks', { title: String(title || '').trim(), dueAt: due.toISOString(), type, effort, note: String(note), status: 'pending', completedAt: null, logNote: '', phaseAtDue: phaseAt(due), source: source === 'assistant' ? 'assistant' : 'user' });
      },
      // Keeps the time of day, moves the date, and resets a missed task to pending.
      moveTask(id, date) {
        const task = state.logs.tasks.find((t) => t.id === id);
        if (!task) return;
        const [y, m, d] = toISODate(date).split('-').map(Number);
        const due = new Date(task.dueAt);
        due.setFullYear(y, m - 1, d);
        const status = task.status === 'done' ? 'done' : due.getTime() < now().getTime() ? 'missed' : 'pending';
        updateLog('tasks', id, { dueAt: due.toISOString(), phaseAtDue: phaseAt(due), status });
      },
      completeTask(id, logNote = '') { updateLog('tasks', id, { status: 'done', completedAt: now().toISOString(), logNote: String(logNote) }); },
      reopenTask(id) {
        const task = state.logs.tasks.find((t) => t.id === id);
        if (!task) return;
        const overdue = new Date(task.dueAt).getTime() < now().getTime();
        updateLog('tasks', id, { status: overdue ? 'missed' : 'pending', completedAt: null });
      },
      // Run on app start and on an interval: tasks past due and not done become missed (-1).
      markOverdueTasks() {
        const t = now().getTime();
        const overdue = state.logs.tasks.filter((task) => task.status === 'pending' && new Date(task.dueAt).getTime() < t);
        overdue.forEach((task) => updateLog('tasks', task.id, { status: 'missed' }));
        return overdue.length;
      },

      /* generic */
      // Changes a task: any of title, dueAt, type, effort. Status follows the new time, as in moveTask.
      editTask(id, patch) {
        const task = state.logs.tasks.find((t) => t.id === id);
        if (!task) return false;
        const next = {};
        if (patch.title) next.title = String(patch.title).trim().slice(0, 200);
        if (TASK_TYPES.includes(patch.type)) next.type = patch.type;
        if (TASK_EFFORT.includes(patch.effort)) next.effort = patch.effort;
        if (patch.dueAt) {
          const due = new Date(patch.dueAt);
          if (!Number.isNaN(due.getTime())) {
            next.dueAt = due.toISOString();
            next.phaseAtDue = phaseAt(due);
            if (task.status !== 'done') next.status = due.getTime() < now().getTime() ? 'missed' : 'pending';
          }
        }
        updateLog('tasks', id, next);
        return true;
      },
      updateEntry(kind, id, patch) { updateLog(kind, id, patch); },
      removeEntry(kind, id) {
        set(Object.assign({}, state, { logs: Object.assign({}, state.logs, { [kind]: state.logs[kind].filter((e) => e.id !== id) }) }));
      },
      exportData() { return JSON.stringify(state, null, 2); },
      exportCSV() { return exportCSV(state); },
      updateNotifications(patch) {
        return patchSection('settings', { notifications: Object.assign({}, state.settings.notifications, patch) });
      },
      updateConsent(patch) {
        return patchSection('settings', { assistantCanUse: Object.assign({}, state.settings.assistantCanUse, patch) });
      },
      importData(json) { return set(migrate(typeof json === 'string' ? safeParse(json) : safeParse(JSON.stringify(json)))); },
      updateAssistant(patch) {
        return patchSection('settings', { assistant: normalizeAssistant(Object.assign({}, state.settings.assistant, patch)) });
      },
      deleteAllData() {
        try { storage.removeItem(key); } catch (e) { /* ignore */ }
        state = createInitialState();
        listeners.forEach((fn) => fn(state));
        return state;
      },
    };

    const selectors = {
      currentPhase() { return getCurrentPhase(state, now()); },
      phaseFor(date) { return getPhaseInfo(state.cycle, date, state.logs.periods); },
      nextPeriod() { return predictNextPeriod(state.cycle, state.logs.periods, now()); },
      monthGrid(year, month) { return getMonthGrid(state.cycle, year, month, state.logs.periods); },
      week(startDate) { return getPhaseRange(state.cycle, toISODate(startDate || now()), 7, state.logs.periods); },
      calorieTarget() { return getCalorieTarget(state, now()); },

      // Everything the dashboard and the day detail sheet need for one date.
      day(date) {
        const d = toISODate(date || now());
        const meals = state.logs.meals.filter((m) => m.date === d);
        const totals = meals.reduce((t, m) => ({ kcal: t.kcal + m.kcal, carbsG: t.carbsG + m.carbsG, proteinG: t.proteinG + m.proteinG, fatG: t.fatG + m.fatG }), { kcal: 0, carbsG: 0, proteinG: 0, fatG: 0 });
        const target = d === today(now()) ? getCalorieTarget(state, now()) : null;
        const moods = state.logs.moods.filter((m) => m.date === d);
        const allMoods = moods.flatMap((m) => m.moods);
        const tasks = state.logs.tasks.filter((t) => toISODate(new Date(t.dueAt)) === d);
        const ratio = target ? totals.kcal / target.kcal : null;
        return {
          date: d,
          phase: getPhaseInfo(state.cycle, d, state.logs.periods),
          meals,
          totals,
          target,
          ring: ratio == null ? null : { ratio, percent: Math.round(ratio * 100), remainingKcal: Math.max(0, target.kcal - totals.kcal), color: ringColor(ratio) },
          workouts: state.logs.workouts.filter((w) => w.date === d),
          tasks,
          moods,
          moodScore: moodScore(allMoods),
          symptoms: state.logs.symptoms.filter((s) => s.date === d),
          productivity: productivityScore(tasks),
        };
      },

      productivityDays(startDate, days) { return productivityByDay(state.logs.tasks, toISODate(startDate), days); },
      productivityYear(year) { return productivityByMonth(state.logs.tasks, year); },
      tasksOn(date) {
        const d = toISODate(date);
        return state.logs.tasks.filter((t) => taskDate(t) === d).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      },
      taskAdvice(task) { return getTaskAdvice(state.cycle, state.logs.periods, task, state.logs.tasks, state.logs.moods, today(now())); },
      can(feature) { return can(state, feature); },
      setupStepAllowed() { return setupStepAllowed(state); },
      setupComplete() { return setupComplete(state); },
      workoutPlan() { return getWorkoutPlan(state, today(now())); },
      moodDays(startDate, days) { return moodByDay(state.logs.moods, toISODate(startDate), days); },
      moodYear(year) { return moodByMonth(state.logs.moods, year); },
      moodPhases() { return moodByPhase(state.cycle, state.logs.periods, state.logs.moods); },

      // Tasks grouped by the phase they were due in (completion by phase chart).
      productivityByPhase() {
        const out = {};
        PHASE_ORDER.forEach((p) => { out[p] = productivityScore(state.logs.tasks.filter((t) => t.phaseAtDue === p)); });
        return out;
      },
    };

    return {
      getState: () => state,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      actions,
      select: selectors,
    };
  }

  return {
    SCHEMA_VERSION, PHASES, PHASE_ORDER, ACTIVITY_TIERS, FLOW, GOALS, CONDITIONS, DIET_STYLES, ALLERGY_PRESETS,
    OCCUPATIONS, WORKOUT_PREFERENCES, WORKOUT_TYPES, MEALS, TASK_TYPES, TASK_EFFORT, TASK_STATUS, MOODS,
    NUTRITION_CONFIG, CYCLE_LIMITS,
    // dates
    isISODate, toISODate, addDays, daysBetween, today,
    // state
    createInitialState, generateUsername, migrate, createStore,
    // cycle engine
    getPhaseBoundaries, getCycleDay, getEffectiveCycle, getPhaseInfo, getCurrentPhase, predictNextPeriod, getPhaseRange, getMonthGrid,
    // nutrition and scores
    getCalorieTarget, ringColor, moodScore, productivityScore,
    // planner
    taskDate, weekStartOf, productivityByDay, productivityByMonth, getTaskAdvice, can, PRO_FEATURES,
    // workouts
    WORKOUT_CONFIG, getWorkoutPlan, exercisesFor,
    // mood history
    moodByDay, moodByMonth, moodByPhase,
    // export and reminders
    exportCSV, dueReminders,
    // setup
    setupComplete, setupStepAllowed,
    // assistant
    ASSISTANT_DEFAULTS, AGENT_TOOLS, AGENT_MODES, buildAssistantContext, assistantSnapshot, setupStatus, validateToolCall, runReadTool, safeParse,
    findTarget, targetsEntry,
    // profile
    ageOn, AVATAR_COLORS, AVATAR_EMOJIS, normalizeAvatar,
  };
});
