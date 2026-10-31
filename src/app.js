/*
 * Petal UI: renders the reference frames (F2 to F12) from live engine state.
 * Depends on window.Petal from petal-engine.js. Hash routes:
 *   #/setup/1 .. #/setup/7   onboarding (F2 to F8)
 *   #/                       dashboard (F9), meal menu (F10), day detail (F11)
 *   #/mood                   mood log (F12)
 *   #/assistant              assistant chat (F13), local model through src/assistant.js
 *   #/pro                    plans, not built yet
 * Add ?today=2026-10-31 to the URL to pin the date (matches the mockups).
 */
(function () {
  'use strict';
  const P = window.Petal;

  /* ------------------------------------------------------------------ */
  /* Setup                                                               */
  /* ------------------------------------------------------------------ */

  const pinned = new URLSearchParams(location.search).get('today');
  function now() {
    const d = new Date();
    if (pinned && P.isISODate(pinned)) {
      const [y, m, dd] = pinned.split('-').map(Number);
      d.setFullYear(y, m - 1, dd);
    }
    return d;
  }

  const store = P.createStore({ now });
  const app = document.getElementById('app');
  const ui = {
    overlay: null,       // { type: 'radial' | 'meal' | 'workout' | 'event' | 'day' | 'menu', ... }
    weekStart: null,     // Monday of the week shown on the dashboard
    calMonth: null,      // { y, m } for the setup calendar
    usernameEdit: false,
    usernameTouched: false,
    allergyQuery: '',
    heightUnit: 'cm',
    weightUnit: 'kg',
    moodDraft: { moods: [], note: '' },
    toast: null,
    goalsView: 'day',    // 'day' | 'week' | 'month'
    goalsDate: null,     // day the planner is centred on
    trendsView: 'week',  // 'week' | 'month' | 'year'
    newTask: null,       // draft for #/goals/new
    keepOverlay: false,  // set before a hash change that should open a sheet
    session: null,       // { screen, kind, startedAt, done: [slug] } while a strength or mat session runs
    run: null,           // { startedAt, accMs, running } for the running timer
    moodView: 'week',    // 'week' | 'month' | 'year'
    moodReturn: '#/',    // where closing the mood log goes back to
    settingsBack: '#/settings', // where Mode goes back to (the menu opens it from any page)
    editReturn: null,    // set when a setup step is opened from Settings to edit one answer
  };

  /* ------------------------------------------------------------------ */
  /* Copy and formatting                                                 */
  /* ------------------------------------------------------------------ */

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const LABELS = {
    goal: { loss: 'Weight loss', gain: 'Muscle gain or weight gain', maintain: 'Weight maintenance and hormonal balance' },
    conditions: { pcos: 'PCOS', endometriosis: 'Endometriosis', thyroid: 'Thyroid conditions', diabetes: 'Diabetes', blood_pressure: 'High or low blood pressure', none: 'None' },
    dietStyles: { halal: 'Halal', carnivore: 'Carnivore', vegan: 'Vegan', vegetarian: 'Vegetarian', keto: 'Keto', mediterranean: 'Mediterranean', none: 'No restrictions' },
    allergies: { gluten: 'Gluten-free', dairy: 'Dairy-free', nuts: 'Nuts', soy: 'Soy', shellfish: 'Shellfish' },
    workoutsLiked: { weights: 'Weight training', pilates: 'Pilates', yoga: 'Yoga', running: 'Running', hiit: 'HIIT', swimming: 'Swimming', cycling: 'Cycling', walking: 'Walking', barre: 'Barre' },
    occupation: { student: 'Student', professional: 'Working professional', homemaker: 'Stay at home or homemaker', freelancer: 'Freelancer or self employed' },
    workoutType: { weights: 'Weight training', pilates: 'Pilates', yoga: 'Yoga', running: 'Running', walking: 'Walking', other: 'Other' },
    meal: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' },
    taskType: { work: 'Work', study: 'Study', personal: 'Personal', home: 'Home' },
    effort: { light: 'Light', medium: 'Medium', deep: 'Deep focus' },
  };

  const PHASE_STORY = {
    menstrual: 'Estrogen and progesterone are low, so energy can dip. Iron rich foods and rest help.',
    follicular: 'Estrogen is rising, so energy and focus usually climb. A good time to start new things.',
    ovulation: 'Estrogen peaks around now, so energy and confidence are often at their highest.',
    luteal: 'Progesterone is high, so appetite and body temperature rise. Complex carbs help steady blood sugar.',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function parts(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  }
  function fmtLong(iso) { const p = parts(iso); return DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m - 1]; }
  function fmtDay(iso) { const p = parts(iso); return p.d + ' ' + MONTHS[p.m - 1]; }
  function monthName(m, short) { return short ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]; }
  // "9 to 11 November", or "30 November to 2 December"
  function fmtRange(a, b, short) {
    const pa = parts(a), pb = parts(b);
    if (pa.m === pb.m) return pa.d + ' to ' + pb.d + ' ' + monthName(pb.m, short);
    return pa.d + ' ' + monthName(pa.m, short) + ' to ' + pb.d + ' ' + monthName(pb.m, short);
  }
  function fmtBetween(a, b) {
    const pa = parts(a), pb = parts(b);
    if (pa.m === pb.m) return 'between ' + pa.d + ' and ' + pb.d + ' ' + monthName(pb.m);
    return 'between ' + pa.d + ' ' + monthName(pa.m) + ' and ' + pb.d + ' ' + monthName(pb.m);
  }
  function num(n) { return Math.round(n).toLocaleString('en-US'); }
  function painWord(p) { return p <= 3 ? 'mild' : p <= 6 ? 'moderate' : p <= 8 ? 'strong' : 'severe'; }
  function fmtTime(isoDateTime) {
    const d = new Date(isoDateTime);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function mondayOf(iso) { return P.addDays(iso, -((parts(iso).dow + 6) % 7)); }

  /* ------------------------------------------------------------------ */
  /* Icons (outline, 24px grid, currentColor)                            */
  /* ------------------------------------------------------------------ */

  const I = {
    back: '<path d="M15 6l-6 6 6 6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    tick: '<path d="M5 12l5 5 9-10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    dots: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
    drop: '<path d="M12 3c3.5 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 2.5-6.5 6-11z"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    sprout: '<path d="M12 20v-8M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2-5-6-5 0 3 2 5 6 5z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4V5z"/>',
    dumbbell: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    crown: '<path d="M4 18L3 8l5 4 4-7 4 7 5-4-1 10z"/>',
    cup: '<path d="M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9zM17 10h2a2 2 0 0 1 0 4h-2"/>',
    fork: '<path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8M7 7h4M17 3c-2 2-3 5-3 8h3v10"/>',
    apple: '<path d="M12 8c-3-2-7 0-6 5 .6 3.5 3 7 5 7 .8 0 1-.5 1-.5s.2.5 1 .5c2 0 4.4-3.5 5-7 1-5-3-7-6-5zM12 8c0-2 1-3 3-4"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    face: '<circle cx="12" cy="12" r="9"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
    logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/>',
    ruler: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
    leaf: '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l8-8"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17v.5"/>',
    card: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M9 7V5h6v2M3 12h18"/>',
  };
  function svg(name, extra) { return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (extra || '') + '>' + I[name] + '</svg>'; }
  const PHASE_ICON = { menstrual: 'drop', follicular: 'sprout', ovulation: 'sun', luteal: 'moon' };
  const MEAL_ICON = { breakfast: 'cup', lunch: 'sun', dinner: 'moon', snack: 'apple' };

  const MOOD_FACES = {
    energized: '<circle cx="12" cy="12" r="9"/><circle class="e" cx="9" cy="10" r="1.2"/><circle class="e" cx="15" cy="10" r="1.2"/><path d="M8 14c1 3 7 3 8 0"/><path d="M7.5 7.5l1.5-1M16.5 7.5L15 6.5"/>',
    anxious: '<circle cx="12" cy="12" r="9"/><circle class="e" cx="9" cy="10" r="1.2"/><circle class="e" cx="15" cy="10" r="1.2"/><path d="M8 15.5q1-1.2 2 0t2 0 2 0"/><path d="M7.5 7l2 1M16.5 7l-2 1"/>',
    calm: '<circle cx="12" cy="12" r="9"/><path d="M7.5 10q1.5 1.5 3 0M13.5 10q1.5 1.5 3 0"/><path d="M9 14.5q3 2 6 0"/>',
    irritable: '<circle cx="12" cy="12" r="9"/><circle class="e" cx="9" cy="10" r="1.2"/><circle class="e" cx="15" cy="10" r="1.2"/><path d="M7.5 7.5l3 1.5M16.5 7.5L13.5 9"/><path d="M9 15.5h6"/>',
    bloated: '<circle cx="12" cy="12" r="9"/><circle class="e" cx="9" cy="10" r="1.2"/><circle class="e" cx="15" cy="10" r="1.2"/><circle cx="12" cy="15" r="1.8"/>',
    focused: '<circle cx="12" cy="12" r="9"/><circle class="e" cx="9" cy="10" r="1.2"/><circle class="e" cx="15" cy="10" r="1.2"/><path d="M7.5 7.5h3M13.5 7.5h3"/><path d="M9.5 15h5"/>',
    exhausted: '<circle cx="12" cy="12" r="9"/><path d="M7.5 10.5h3M13.5 10.5h3"/><path d="M9 16q3-2 6 0"/><path d="M8 8.5l2 .5M16 8.5l-2 .5"/>',
  };
  const MOOD_ORDER = ['energized', 'anxious', 'calm', 'irritable', 'bloated', 'focused', 'exhausted'];

  const LOGO = '<svg viewBox="0 0 100 100" width="24" height="24" role="img" aria-label="Petal logo"><rect width="100" height="100" rx="28" fill="#a01878"/><g transform="translate(50 50)"><path transform="rotate(270) translate(3 3)" d="M0 0A21 21 0 0 1 26 26A21 21 0 0 1 0 0Z" fill="#f26b6b"/><path transform="rotate(0) translate(3 3)" d="M0 0A21 21 0 0 1 26 26A21 21 0 0 1 0 0Z" fill="#8fd694"/><path transform="rotate(90) translate(3 3)" d="M0 0A21 21 0 0 1 26 26A21 21 0 0 1 0 0Z" fill="#ffd24a"/><path transform="rotate(180) translate(3 3)" d="M0 0A21 21 0 0 1 26 26A21 21 0 0 1 0 0Z" fill="#8ec5f0"/><circle r="4" fill="#ffffff"/></g></svg>';

  /* ------------------------------------------------------------------ */
  /* Shared pieces                                                       */
  /* ------------------------------------------------------------------ */

  function phaseChip(info, text) {
    return '<span class="chip chip-' + info.phase + '">' + svg(PHASE_ICON[info.phase], ' width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"') + esc(text || info.label) + '</span>';
  }

  function tabs(current) {
    const items = [['cycle', 'Cycle', 'drop'], ['workout', 'Workout', 'dumbbell'], ['assistant', 'Assistant', 'chat'], ['goals', 'Goals', 'target'], ['pro', 'Pro', 'crown']];
    return '<nav class="tabs" aria-label="Main">' + items.map(([key, label, icon]) =>
      '<button class="tab" data-act="go" data-to="' + (key === 'cycle' ? '#/' : key === 'goals' ? '#/goals' : key === 'workout' ? '#/workout' : '#/' + key) + '"' + (current === key ? ' aria-current="page"' : '') + '>' + svg(icon) + label + '</button>'
    ).join('') + '</nav>';
  }

  function header() {
    const s = store.getState();
    const initial = (s.profile.displayName || 'P').charAt(0).toUpperCase();
    return '<div class="top" style="justify-content: space-between">' +
      '<button class="ico avatar" data-act="go" data-to="#/settings" aria-label="Profile and settings">' + esc(initial) + '</button>' +
      '<div style="display: flex; align-items: center; gap: 8px">' + LOGO + '<span style="font: 800 20px/24px var(--font-sans); color: var(--plum)">Petal</span></div>' +
      '<button class="ico" data-act="open" data-type="menu" aria-label="Settings" style="width: 44px; height: 44px">' + svg('dots') + '</button>' +
      '</div>';
  }

  // Calorie ring drawn as short arcs so the colour can sweep green, amber, orange, red.
  const RING_STOPS = [[0, [0x8f, 0xd6, 0x94]], [0.5, [0xff, 0xd2, 0x4a]], [0.8, [0xf5, 0x9e, 0x42]], [1, [0xf2, 0x6b, 0x6b]]];
  function rampColor(t) {
    for (let i = 1; i < RING_STOPS.length; i++) {
      const [t1, c1] = RING_STOPS[i];
      const [t0, c0] = RING_STOPS[i - 1];
      if (t <= t1) {
        const k = (t - t0) / (t1 - t0);
        return '#' + c0.map((v, j) => Math.round(v + (c1[j] - v) * k).toString(16).padStart(2, '0')).join('');
      }
    }
    return '#f26b6b';
  }
  function ringSVG(ratio, label) {
    const c = 66, r = 54;
    const pt = (a) => [(c + r * Math.sin(2 * Math.PI * a)).toFixed(2), (c - r * Math.cos(2 * Math.PI * a)).toFixed(2)];
    const frac = Math.max(0, Math.min(1, ratio));
    let out = '<svg viewBox="0 0 132 132" width="132" height="132" role="img" aria-label="' + esc(label) + '"><circle cx="66" cy="66" r="54" fill="none" stroke="var(--surface-300)" stroke-width="14"/>';
    if (frac > 0) {
      const n = Math.max(2, Math.ceil(frac * 72));
      for (let i = 0; i < n; i++) {
        const a0 = (frac * i) / n, a1 = Math.min(frac, (frac * (i + 1)) / n + 0.003);
        const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
        out += '<path d="M' + x0 + ' ' + y0 + 'A54 54 0 0 1 ' + x1 + ' ' + y1 + '" fill="none" stroke="' + rampColor(a0) + '" stroke-width="14"/>';
      }
      const [sx, sy] = pt(0), [ex, ey] = pt(frac >= 1 ? 0.9999 : frac);
      out += '<circle cx="' + sx + '" cy="' + sy + '" r="7" fill="' + rampColor(0) + '"/><circle cx="' + ex + '" cy="' + ey + '" r="7" fill="' + rampColor(frac) + '"/>';
    }
    return out + '</svg>';
  }

  function sheet(label, body) {
    return '<div class="scrim" data-act="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(label) + '"><div class="handle"></div>' + body + '</section>';
  }
  function sheetHead(title, sub) {
    return '<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px"><div style="display: flex; flex-direction: column; gap: 6px"><h2 class="t-title" style="margin: 0">' + title + '</h2>' + (sub || '') + '</div><button type="button" class="ico" data-act="close" aria-label="Close" style="width: 44px; height: 44px">' + svg('close') + '</button></div>';
  }
  function options(map, selected) {
    return Object.entries(map).map(([v, l]) => '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
  }

  /* ------------------------------------------------------------------ */
  /* Setup screens (F2 to F8)                                            */
  /* ------------------------------------------------------------------ */

  function setupFrame(step, inner, cta) {
    const bars = Array.from({ length: 7 }, (_, i) => '<i' + (i < step ? ' class="on"' : '') + '></i>').join('');
    if (ui.editReturn) cta = 'Save';
    const backTo = ui.editReturn || (step > 1 ? '#/setup/' + (step - 1) : (store.getState().settings.onboardingStep === 'done' ? '#/' : null));
    return '<div class="ph">' +
      '<div class="top">' +
      (backTo ? '<button class="back" data-act="go" data-to="' + backTo + '" aria-label="Back">' + svg('back') + '</button>' : '<span style="width:44px"></span>') +
      '<div class="prog" style="grid-template-columns: repeat(7, 1fr)">' + bars + '</div><span class="steplab">Step ' + step + ' of 7</span></div>' +
      inner +
      '<div class="foot" style="padding-top: 16px"><button class="pt-btn pt-btn-primary block" data-act="continue" data-step="' + step + '">' + (cta || 'Continue') + '</button></div></div>';
  }

  function chipGroup(section, field, values, labels) {
    return '<div class="chips">' + Object.keys(labels).map((v) => {
      const on = values.includes(v);
      return '<button class="opt' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="toggle" data-section="' + section + '" data-field="' + field + '" data-value="' + v + '">' + (on ? svg('tick') : '') + esc(labels[v]) + '</button>';
    }).join('') + '</div>';
  }

  function selCard(on, attrs, icon, title, sub) {
    return '<button class="sel' + (on ? ' on' : '') + '" aria-pressed="' + on + '" ' + attrs + '>' +
      (icon ? '<span class="ic">' + icon + '</span>' : '') +
      '<span class="tx"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span>' +
      '<span class="tick">' + svg('tick') + '</span></button>';
  }

  const SETUP = {
    1() {
      const p = store.getState().profile;
      const initial = (p.displayName || '?').charAt(0).toUpperCase();
      const un = ui.usernameEdit
        ? '<input id="un" class="inp" type="text" data-bind="profile.username" value="' + esc(p.username) + '" autocomplete="off">'
        : '<div class="inp-row"><span id="un" class="v">@' + esc(p.username || 'your_name') + '</span><button class="ico" data-act="edit-username" aria-label="Edit username">' + svg('edit') + '</button></div>';
      return setupFrame(1,
        '<h1 class="t-title">What should we call you?</h1><p class="t-sub">Your name appears on your home screen and in chats with your assistant.</p>' +
        '<div style="margin-top: 32px; display: flex; justify-content: center"><div id="avatar" class="petal" style="width: 112px; height: 112px; background: var(--surface-300); border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: 800; color: var(--plum)" role="img" aria-label="Avatar preview with the letter ' + esc(initial) + '">' + esc(initial) + '</div></div>' +
        '<div class="sec" style="margin-top: 32px"><div class="field"><label for="dn">Display name</label><input id="dn" class="inp" type="text" data-bind="profile.displayName" value="' + esc(p.displayName) + '" autocomplete="given-name" maxlength="40"></div>' +
        '<div class="field"><label for="un">Username</label>' + un + '<p class="t-cap">We made this one for you. You can change it now or later in your profile.</p></div></div>');
    },

    2() {
      const c = store.getState().cycle;
      const t = P.today(now());
      if (!ui.calMonth) { const p = parts(c.lastPeriodStart || t); ui.calMonth = { y: p.y, m: p.m }; }
      const { y, m } = ui.calMonth;
      const first = y + '-' + String(m).padStart(2, '0') + '-01';
      const offset = (parts(first).dow + 6) % 7;
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => '<span class="pt-cal-dow">' + d + '</span>').join('');
      cells += '<span class="pt-day blank"></span>'.repeat(offset);
      for (let d = 1; d <= dim; d++) {
        const iso = P.addDays(first, d - 1);
        const sel = iso === c.lastPeriodStart;
        const inPeriod = c.lastPeriodStart && P.daysBetween(c.lastPeriodStart, iso) > 0 && P.daysBetween(c.lastPeriodStart, iso) < c.periodLength;
        const cls = sel ? ' pt-day-sel' : inPeriod ? ' pt-day-period' : iso === t ? ' pt-day-today' : '';
        cells += '<button class="pt-day' + cls + '" data-act="pick-period" data-date="' + iso + '" aria-label="' + d + ' ' + MONTHS[m - 1] + ' ' + y + '"' + (sel ? ' aria-pressed="true"' : '') + (iso > t ? ' disabled' : '') + '>' + d + '</button>';
      }
      const tp = parts(t);
      const atLatest = y > tp.y || (y === tp.y && m >= tp.m);
      const stepper = (field, label, hint, unit) =>
        '<div class="stepper"><div class="lab"><b>' + label + '</b><span>' + hint + '</span></div><div class="ctl">' +
        '<button data-act="step" data-field="' + field + '" data-d="-1" aria-label="Fewer days">' + svg('minus') + '</button>' +
        '<span class="val" aria-live="polite">' + c[field] + ' ' + unit + '</span>' +
        '<button data-act="step" data-field="' + field + '" data-d="1" aria-label="More days">' + svg('plus') + '</button></div></div>';
      return setupFrame(2,
        '<h1 class="t-title" style="margin-top: 16px">Your cycle baseline</h1><p class="t-sub">Tap the first day of your last period. We use it to place you in one of four phases.</p>' +
        '<div class="pt-card" style="margin-top: 16px; padding: 12px"><div class="mon">' +
        '<button data-act="cal-month" data-d="-1" aria-label="Previous month">' + svg('back') + '</button><b>' + MONTHS[m - 1] + ' ' + y + '</b>' +
        '<button data-act="cal-month" data-d="1" aria-label="Next month"' + (atLatest ? ' disabled' : '') + '>' + svg('next') + '</button></div>' +
        '<div class="pt-cal">' + cells + '</div>' +
        '<div class="pt-legend" style="margin-top: 12px"><span><i style="background: var(--period); border: 2px solid var(--ink-on-fill); box-sizing: border-box"></i>First day</span><span><i style="background: var(--period)"></i>Period days</span><span><i style="background: var(--action)"></i>Today</span></div></div>' +
        '<p class="t-cap" id="err" role="alert" style="margin-top: 8px; color: var(--period-ink)"></p>' +
        '<div class="sec" style="margin-top: 4px; gap: 8px">' +
        stepper('periodLength', 'Period length', 'Most last 3 to 7 days', 'days') +
        stepper('cycleLength', 'Cycle length', 'Usually 21 to 35 days', 'days') + '</div>');
    },

    3() {
      const c = store.getState().cycle;
      const drops = (n) => '<span class="ic" style="width:auto;min-width:64px;padding:0 12px;gap:2px;border-radius:9999px">' + Array.from({ length: n }, () => '<svg class="drop" viewBox="0 0 24 24" aria-hidden="true">' + I.drop + '</svg>').join('') + '</span>';
      const flows = [['light', 'Light or spotting', 'A liner is usually enough.', 1], ['medium', 'Medium', 'A pad or tampon every 4 to 6 hours.', 2], ['heavy', 'Heavy', 'You change every 1 to 3 hours.', 3]];
      return setupFrame(3,
        '<h1 class="t-title" style="margin-top: 16px">How do your periods feel?</h1><p class="t-sub">A starting point for your pain and flow patterns. You can log every cycle later.</p>' +
        '<div class="pt-card" style="margin-top: 16px; display: flex; flex-direction: column; gap: 12px"><label for="pain" class="t-head">Usual pain level</label>' +
        '<div style="display: flex; align-items: baseline; gap: 8px"><span id="painv" style="font: 800 64px/64px var(--font-sans); letter-spacing: -0.02em; color: var(--plum)">' + c.typicalPain + '</span><span id="painw" class="t-sub" style="margin: 0">out of 10, ' + painWord(c.typicalPain) + '</span></div>' +
        '<input id="pain" class="range" type="range" min="1" max="10" value="' + c.typicalPain + '" data-bind="cycle.typicalPain">' +
        '<div style="display: flex; justify-content: space-between" class="t-cap"><span>1 Mild or none</span><span>10 Severe</span></div></div>' +
        '<div class="sec" style="gap: 8px"><h2 class="t-head">Usual flow</h2>' +
        flows.map(([v, t, s, n]) => selCard(c.typicalFlow === v, 'data-act="set" data-section="cycle" data-field="typicalFlow" data-value="' + v + '"', drops(n), t, s)).join('') +
        '<p class="t-cap">Pain that stops daily life or very heavy flow is worth raising with a clinician.</p></div>');
    },

    4() {
      const s = store.getState();
      const goalIcons = { loss: '<path d="M12 5v14M6 13l6 6 6-6"/>', gain: '<path d="M12 19V5M6 11l6-6 6 6"/>', maintain: '<path d="M5 12h14M8 8l-3 4 3 4M16 8l3 4-3 4"/>' };
      const h = s.profile.heightCm, w = s.profile.weightKg;
      const hVal = h == null ? '' : ui.heightUnit === 'cm' ? Math.round(h) : Math.floor(h / 30.48) + "'" + Math.round((h / 2.54) % 12);
      const wVal = w == null ? '' : ui.weightUnit === 'kg' ? Math.round(w * 10) / 10 : Math.round(w * 2.20462);
      const seg = (kind, a, b, cur) => '<div class="seg" role="group" aria-label="' + kind + ' unit"><button class="' + (cur === a ? 'on' : '') + '" data-act="unit" data-kind="' + kind + '" data-value="' + a + '" aria-pressed="' + (cur === a) + '">' + a + '</button><button class="' + (cur === b ? 'on' : '') + '" data-act="unit" data-kind="' + kind + '" data-value="' + b + '" aria-pressed="' + (cur === b) + '">' + b + '</button></div>';
      return setupFrame(4,
        '<h1 class="t-title" style="margin-top: 16px">Your body and your goal</h1><p class="t-sub">Used to set calorie and macro targets for each phase. Skip anything you prefer not to share.</p>' +
        '<div class="sec" style="gap: 8px">' + P.GOALS.map((g) => selCard(s.health.goal === g, 'data-act="set" data-section="health" data-field="goal" data-value="' + g + '"', '<svg viewBox="0 0 24 24">' + goalIcons[g] + '</svg>', LABELS.goal[g])).join('') + '</div>' +
        '<div class="sec" style="gap: 12px">' +
        '<div class="field"><div style="display: flex; align-items: center; justify-content: space-between"><label for="h">Height' + (ui.heightUnit === 'ft' ? ', for example 5\'5' : '') + '</label>' + seg('Height', 'cm', 'ft', ui.heightUnit) + '</div>' +
        '<input id="h" class="inp" type="text" inputmode="decimal" data-bind="height" value="' + esc(hVal) + '"></div>' +
        '<div class="field"><div style="display: flex; align-items: center; justify-content: space-between"><label for="w">Weight</label>' + seg('Weight', 'kg', 'lbs', ui.weightUnit) + '</div>' +
        '<input id="w" class="inp" type="text" inputmode="decimal" data-bind="weight" value="' + esc(wVal) + '"></div>' +
        '<div class="field"><label for="age">Age, optional</label><input id="age" class="inp" type="text" inputmode="numeric" data-bind="profile.age" value="' + esc(s.profile.age == null ? '' : s.profile.age) + '"><p class="t-cap">Makes your calorie target more accurate.</p></div></div>' +
        '<div class="sec" style="gap: 8px"><div style="display: flex; align-items: center; justify-content: space-between"><h2 class="t-head">Health considerations</h2><span class="t-label" style="color: var(--plum)">Recommended</span></div>' +
        '<p class="t-cap">These change how hormones and metabolism are read. Pick all that apply.</p>' + chipGroup('health', 'conditions', s.health.conditions, LABELS.conditions) + '</div>');
    },

    5() {
      const h = store.getState().health;
      const q = ui.allergyQuery.trim().toLowerCase();
      const presets = Object.keys(LABELS.allergies).filter((k) => !q || LABELS.allergies[k].toLowerCase().includes(q) || k.includes(q));
      const custom = h.allergies.filter((a) => !LABELS.allergies[a]);
      const presetChips = presets.map((k) => {
        const on = h.allergies.includes(k);
        return '<button class="opt' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="toggle" data-section="health" data-field="allergies" data-value="' + k + '">' + (on ? svg('tick') : '') + LABELS.allergies[k] + '</button>';
      }).join('');
      const customChips = custom.map((a) => '<button class="opt on" data-act="remove-allergy" data-value="' + esc(a) + '" aria-label="Remove ' + esc(a) + '">' + esc(a.charAt(0).toUpperCase() + a.slice(1)) + '<svg viewBox="0 0 24 24" style="stroke-width:2">' + I.close + '</svg></button>').join('');
      return setupFrame(5,
        '<h1 class="t-title" style="margin-top: 16px">What do you eat?</h1><p class="t-sub">We filter meal ideas and food search by your choices.</p>' +
        '<div class="sec" style="gap: 8px"><h2 class="t-head">Dietary style</h2>' + chipGroup('health', 'dietStyles', h.dietStyles, LABELS.dietStyles) + '</div>' +
        '<div class="sec" style="gap: 12px"><h2 class="t-head">Allergies and sensitivities</h2>' +
        '<div class="field"><label for="alg" class="sr-only">Search allergies</label><div class="inp-row" style="padding-left: 14px"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--ink-muted)">' + I.search + '</svg>' +
        '<input id="alg" type="text" placeholder="Search or add your own" data-bind="allergyQuery" value="' + esc(ui.allergyQuery) + '" autocomplete="off" style="flex:1;border:0;background:transparent;font:400 15px/22px var(--font-sans);color:var(--ink);outline-offset:6px"></div></div>' +
        '<div class="chips" id="allergy-chips">' + presetChips + customChips + '</div>' +
        '<button class="pt-btn pt-btn-secondary" data-act="add-allergy" style="align-self: flex-start">' + svg('plus', ' width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"') + 'Add custom entry</button>' +
        '<p class="t-cap">Allergies are used to hide unsafe suggestions. Always check food labels yourself.</p></div>');
    },

    6() {
      const p = store.getState().profile;
      return setupFrame(6,
        '<h1 class="t-title" style="margin-top: 16px">How active are your days?</h1><p class="t-sub">Pick the one that fits a normal day, not your workouts.</p>' +
        '<div class="sec" style="gap: 8px">' + [1, 2, 3, 4].map((t) => selCard(p.activityTier === t, 'data-act="set" data-section="profile" data-field="activityTier" data-value="' + t + '"', '<b style="font:700 15px/20px var(--font-sans)">' + t + '</b>', P.ACTIVITY_TIERS[t].label, P.ACTIVITY_TIERS[t].description)).join('') + '</div>' +
        '<div class="sec" style="gap: 8px"><h2 class="t-head">Workouts you enjoy</h2><p class="t-cap">Pick any. We match them to your phase.</p>' + chipGroup('profile', 'workoutsLiked', p.workoutsLiked, LABELS.workoutsLiked) + '</div>');
    },

    7() {
      const p = store.getState().profile;
      const occ = Object.keys(LABELS.occupation).map((o) => {
        const on = p.occupation === o;
        return '<button class="sel' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="set" data-section="profile" data-field="occupation" data-value="' + o + '" style="min-height:72px;padding:12px 14px"><span class="tx"><b style="font-size:14px;line-height:20px">' + LABELS.occupation[o] + '</b></span></button>';
      }).join('');
      return setupFrame(7,
        '<h1 class="t-title" style="margin-top: 16px">A little about your life</h1><p class="t-sub">So plans fit your time and energy.</p>' +
        '<div class="sec" style="gap: 8px"><h2 class="t-head">What best describes you?</h2><div class="grid2">' + occ + '</div></div>' +
        '<div class="sec" style="gap: 12px">' +
        '<div class="row-card"><div class="tx"><b id="mom">Are you a mom?</b><span>We shorten workouts and suggest quick meals.</span></div><button class="switch" role="switch" aria-checked="' + p.isMom + '" aria-labelledby="mom" data-act="switch" data-field="isMom"></button></div>' +
        '<div class="row-card"><div class="tx"><b id="sx">Sexually active?</b><span>Optional. Adds context to your fertile window estimate, which is not a contraceptive method.</span></div><button class="switch" role="switch" aria-checked="' + (p.sexuallyActive === true) + '" aria-labelledby="sx" data-act="switch" data-field="sexuallyActive"></button></div>' +
        '<p class="t-cap">You can change any answer later in your profile. This is an estimate, not medical advice.</p></div>', 'Finish setup');
    },
  };

  /* ------------------------------------------------------------------ */
  /* Dashboard (F9) with meal menu (F10)                                 */
  /* ------------------------------------------------------------------ */

  function dashboard() {
    const s = store.getState();
    const t = P.today(now());
    const day = store.select.day(t);
    const info = day.phase;
    const next = store.select.nextPeriod();

    // Calorie card
    let ring;
    if (day.target) {
      const pct = day.ring.percent;
      const over = day.totals.kcal - day.target.kcal;
      ring = '<div style="position: relative; width: 132px; height: 132px; flex: none">' + ringSVG(day.ring.ratio, pct + ' percent of the daily calorie limit used') +
        '<div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center"><span style="font: 800 24px/28px var(--font-sans); letter-spacing: -0.01em">' + num(day.totals.kcal) + '</span><span class="t-cap">of ' + num(day.target.kcal) + '</span></div></div>' +
        '<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><span style="font: 700 18px/24px var(--font-sans)">' + (over > 0 ? num(over) + ' kcal over' : num(day.ring.remainingKcal) + ' kcal left') + '</span>' +
        '<span class="chip chip-line" style="align-self: flex-start"><i style="display:inline-block;width:10px;height:10px;border-radius:9999px;background:' + day.ring.color + '"></i>' + pct + '% of your limit</span>' +
        '<span class="t-cap">The ring moves from green to amber, then orange near 80% and red at your limit.</span></div>';
    } else {
      ring = '<div style="position: relative; width: 132px; height: 132px; flex: none">' + ringSVG(0, 'No calorie target yet') +
        '<div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center"><span style="font: 800 24px/28px var(--font-sans)">' + num(day.totals.kcal) + '</span><span class="t-cap">kcal today</span></div></div>' +
        '<div style="display: flex; flex-direction: column; gap: 8px; min-width: 0"><span style="font: 700 16px/22px var(--font-sans)">Add your height and weight to get a target</span><button class="pt-btn pt-btn-secondary" data-act="go" data-to="#/setup/4" style="align-self: flex-start; height: 44px">Add details</button></div>';
    }
    const macro = (label, color, val, target, extra) => {
      const w = target ? Math.min(100, Math.round((val / target) * 100)) : 0;
      return '<div class="macro"><span class="t-cap"><i class="dotc" style="background: ' + color + (extra || '') + '"></i>' + label + '</span><b>' + Math.round(val) + (target ? ' / ' + target : '') + ' g</b><div class="bar s"><i style="width: ' + w + '%; background: ' + color + '"></i></div></div>';
    };
    const tg = day.target || {};

    const radial = ui.overlay && ui.overlay.type === 'radial';
    const radialPos = { breakfast: [-150, -10], lunch: [-131, 60], dinner: [-80, 111], snack: [-10, 130] };
    const radialHtml = radial
      ? '<div class="scrim" data-act="close"></div><div class="radial-anchor">' +
        '<button class="addbtn" data-act="close" aria-label="Close meal menu" style="position: relative; z-index: 22; transform: rotate(45deg)">' + svg('plus') + '</button>' +
        P.MEALS.map((m) => '<button class="radial" data-act="open" data-type="meal" data-meal="' + m + '" style="left: ' + radialPos[m][0] + 'px; top: ' + radialPos[m][1] + 'px" aria-label="Log ' + LABELS.meal[m].toLowerCase() + '">' + svg(MEAL_ICON[m]) + LABELS.meal[m] + '</button>').join('') + '</div>'
      : '';

    // Planner card
    let planner;
    if (info) {
      if (!ui.weekStart) ui.weekStart = mondayOf(t);
      const week = store.select.week(ui.weekStart);
      const seen = new Set();
      const cells = week.map((d) => {
        const p = parts(d.date);
        let cls = 'pt-day', desc;
        if (d.isOvulationDay) { cls += ' pt-day-ovulation'; desc = 'ovulation day'; seen.add('fertile'); }
        else if (d.isFertile) { cls += ' pt-day-fertile'; desc = 'fertile window'; seen.add('fertile'); }
        else if (d.phase === 'menstrual') { cls += ' pt-day-period'; desc = 'period'; seen.add('menstrual'); }
        else { cls += ' pt-day-' + d.phase; desc = d.phase + ' phase'; seen.add(d.phase); }
        if (d.date === t) { cls = 'pt-day pt-day-today'; desc = 'today, ' + d.phase + ' day ' + d.cycleDay; seen.add('today'); }
        return '<button class="' + cls + '" data-act="open" data-type="day" data-date="' + d.date + '" aria-label="' + p.d + ' ' + MONTHS[p.m - 1] + ', ' + desc + '">' + p.d + '</button>';
      }).join('');
      const legend = [['menstrual', 'var(--period)', 'Period'], ['follicular', 'var(--follicular)', 'Follicular'], ['fertile', 'var(--ovulation)', 'Fertile'], ['luteal', 'var(--luteal)', 'Luteal'], ['today', 'var(--action)', 'Today']]
        .filter(([k]) => seen.has(k)).map(([, c, l]) => '<span><i style="background: ' + c + '"></i>' + l + '</span>').join('');
      const ws = parts(ui.weekStart), we = parts(P.addDays(ui.weekStart, 6));
      const tok = P.PHASES[info.phase].token;
      planner = '<section class="pt-card" style="margin-top: 16px; border-radius: 24px" aria-label="Cycle planner">' +
        '<div style="display: flex; align-items: center; gap: 12px"><span class="ico" style="width: 40px; height: 40px; background: var(' + tok + '); color: var(--ink-on-fill); cursor: default">' + svg(PHASE_ICON[info.phase]) + '</span>' +
        '<div style="display: flex; flex-direction: column"><b style="font: 700 18px/24px var(--font-sans)">' + info.label + ', day ' + info.cycleDay + '</b><span class="t-cap">Focus: ' + esc(info.hints.focus.toLowerCase()) + '</span></div></div>' +
        '<p class="t-cap" style="margin-top: 12px">' + PHASE_STORY[info.phase] + (next ? ' Your next period is likely ' + fmtBetween(next.earliest, next.latest) + '.' : '') + '</p>' +
        (next && next.irregular ? '<p class="t-cap" style="margin-top: 8px; color: var(--period-ink)">' + esc(next.note) + '</p>' : '') +
        '<div class="mon" style="margin: 8px 0 0"><button data-act="week" data-d="-7" aria-label="Previous week">' + svg('back') + '</button><b>' + ws.d + ' ' + monthName(ws.m, true) + ' to ' + we.d + ' ' + monthName(we.m, true) + '</b><button data-act="week" data-d="7" aria-label="Next week">' + svg('next') + '</button></div>' +
        '<div class="week">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => '<span class="pt-cal-dow">' + d + '</span>').join('') + cells + '</div>' +
        '<div class="pt-legend" style="margin-top: 12px">' + legend + '<span>Tap a day to plan</span></div>' +
        '<p class="t-cap" style="margin-top: 8px">' + esc(info.basis) + '. This is an estimate, not medical advice.</p></section>';
    } else {
      planner = '<section class="pt-card" style="margin-top: 16px"><b class="t-head">Add your last period to see your phase</b><p class="t-cap" style="margin-top: 4px">We need one date to place you in your cycle.</p><button class="pt-btn pt-btn-secondary" data-act="go" data-to="#/setup/2" style="margin-top: 12px">Add date</button></section>';
    }

    return '<div class="ph has-tabs">' + header() +
      '<section class="hero" style="margin-top: 16px" aria-label="Calories and macros">' +
      '<div style="display: flex; align-items: center; justify-content: space-between"><div style="display: flex; align-items: center; gap: 8px">' + (info ? phaseChip(info) + '<span class="t-cap">Day ' + info.cycleDay + '</span>' : '<span class="t-cap">' + esc(fmtLong(t)) + '</span>') + '</div>' +
      (radial ? '<span style="width:44px;height:44px"></span>' : '<button class="addbtn" data-act="open" data-type="radial" aria-label="Add meal">' + svg('plus') + '</button>') + '</div>' +
      radialHtml +
      '<div style="display: flex; align-items: center; gap: 16px; margin-top: 12px">' + ring + '</div>' +
      '<div class="macros" style="margin-top: 16px">' + macro('Carbs', 'var(--luteal)', day.totals.carbsG, tg.carbsG) + macro('Protein', 'var(--action)', day.totals.proteinG, tg.proteinG) + macro('Fats', 'var(--ovulation)', day.totals.fatG, tg.fatG, '; box-shadow: inset 0 0 0 1px var(--ovulation-ink)') + '</div>' +
      '<p class="t-cap" style="margin-top: 12px">' + (day.target ? esc(day.target.basis) + '. Targets adjust to your phase and goal.' : 'Targets adjust to your phase and goal.') + '</p></section>' +
      '<div class="qrow" style="margin-top: 12px">' +
      '<button class="pt-btn pt-btn-secondary" data-act="open" data-type="workout">' + svg('plus') + 'Workout</button>' +
      '<button class="pt-btn pt-btn-secondary" data-act="new-task">' + svg('plus') + 'Event</button>' +
      '<button class="pt-btn pt-btn-secondary" data-act="go" data-to="#/mood/new">' + svg('plus') + 'Mood</button></div>' +
      planner +
      '<button class="fab" data-act="go" data-to="#/assistant" aria-label="Open assistant chat">' + svg('chat') + '</button>' +
      tabs('cycle') + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Overlays: day detail (F11), quick logs, settings menu               */
  /* ------------------------------------------------------------------ */

  function overlay() {
    const o = ui.overlay;
    if (!o || o.type === 'radial') return '';
    if (o.type === 'chat-options') return chatOptionsSheet();
    const t = P.today(now());

    if (o.type === 'day') {
      const day = store.select.day(o.date);
      const next = store.select.nextPeriod();
      const info = day.phase;
      const moodNames = day.moods.flatMap((m) => m.moods).map((m) => P.MOODS[m].label);
      const logged = [];
      day.meals.forEach((m) => logged.push('<div class="lrow"><span class="ic">' + svg(MEAL_ICON[m.meal]) + '</span><div class="tx"><b>' + LABELS.meal[m.meal] + '</b><span>' + esc(m.name || 'Meal') + '</span></div><span class="val">' + num(m.kcal) + ' kcal</span></div>'));
      day.workouts.forEach((w) => logged.push('<div class="lrow"><span class="ic">' + svg('dumbbell') + '</span><div class="tx"><b>' + LABELS.workoutType[w.type] + '</b><span>' + w.durationMin + ' minutes</span></div><span class="val">Effort ' + w.effort + ' of 10</span></div>'));
      if (moodNames.length) logged.push('<div class="lrow"><span class="ic">' + svg('face') + '</span><div class="tx"><b>Mood</b><span>' + esc(moodNames.join(', ')) + '</span></div><span class="val">Score ' + (day.moodScore.chart > 0 ? '+' : '') + day.moodScore.chart + '</span></div>');
      const planned = day.tasks.map((k) => {
        const status = k.status === 'done' ? 'Done' : k.status === 'missed' ? 'Missed' : 'Tap when done';
        return '<button class="lrow" data-act="task" data-id="' + k.id + '" style="width:100%;background:none;border-width:0 0 1px;text-align:left;cursor:pointer" aria-label="' + esc(k.title) + ', ' + status + '"><span class="ic">' + svg(k.status === 'done' ? 'tick' : 'cal') + '</span><div class="tx"><b>' + esc(k.title) + '</b><span>' + fmtTime(k.dueAt) + ', ' + LABELS.taskType[k.type] + '</span></div><span class="val">' + status + '</span></button>';
      });
      let suggestion = '';
      if (info) {
        const lastEffort = day.workouts.length ? day.workouts[day.workouts.length - 1].effort : null;
        suggestion = '<div class="pt-alt" style="background: var(--surface-300)"><b>Suggested for the ' + info.label.toLowerCase() + ' phase</b><span>' + esc(info.hints.training) + '. ' + esc(info.hints.work) + '. Based on your phase' + (lastEffort ? ' and a logged effort of ' + lastEffort + ' of 10' : '') + '.</span></div>';
      }
      return sheet('Day detail',
        sheetHead(esc(fmtLong(o.date)), '<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">' + (info ? phaseChip(info, info.label + ', day ' + info.cycleDay) : '') + (next ? '<span class="t-cap">Next period ' + fmtRange(next.earliest, next.latest, true) + '</span>' : '') + '</div>') +
        '<div><h3 class="t-head" style="margin-bottom: 4px">Logged</h3>' + (logged.length ? logged.join('') : '<p class="t-cap">Nothing logged yet.</p>') + '</div>' +
        '<div><h3 class="t-head" style="margin-bottom: 4px">Planned</h3>' + (planned.length ? planned.join('') : '<p class="t-cap">No events planned.</p>') + '</div>' +
        suggestion +
        '<div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px">' +
        '<button class="pt-btn pt-btn-primary block" data-act="new-task" data-date="' + o.date + '">Add to this day</button>' +
        '<button class="pt-btn pt-btn-outline block" data-act="open" data-type="meal" data-meal="dinner" data-date="' + o.date + '">Log a meal for this day</button></div>');
    }

    if (o.type === 'meal') {
      const field = (id, label, type, extra) => '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" name="' + id + '" class="inp" type="' + type + '" ' + (extra || '') + '></div>';
      return sheet('Log a meal',
        '<form data-form="meal" style="display: contents">' +
        sheetHead('Log ' + LABELS.meal[o.meal].toLowerCase(), '<span class="t-cap">' + esc(fmtLong(o.date || t)) + '</span>') +
        '<input type="hidden" name="meal" value="' + o.meal + '"><input type="hidden" name="date" value="' + (o.date || t) + '">' +
        field('name', 'What did you eat?', 'text', 'required maxlength="80" autocomplete="off"') +
        field('kcal', 'Calories (kcal)', 'number', 'min="0" max="5000" inputmode="numeric" required') +
        '<div class="macros">' + field('carbsG', 'Carbs g', 'number', 'min="0" max="1000" inputmode="decimal"') + field('proteinG', 'Protein g', 'number', 'min="0" max="1000" inputmode="decimal"') + field('fatG', 'Fats g', 'number', 'min="0" max="1000" inputmode="decimal"') + '</div>' +
        '<p class="t-cap">Food search comes later. For now, copy the values from the label.</p>' +
        '<button class="pt-btn pt-btn-primary block" type="submit">Add to daily log</button></form>');
    }

    if (o.type === 'workout') {
      return sheet('Log a workout',
        '<form data-form="workout" style="display: contents">' + sheetHead('Log a workout', '<span class="t-cap">' + esc(fmtLong(o.date || t)) + '</span>') +
        '<input type="hidden" name="date" value="' + (o.date || t) + '">' +
        (o.sets && o.sets.length ? '<p class="t-cap">' + o.sets.length + (o.sets.length === 1 ? ' exercise' : ' exercises') + ' finished in this session.</p>' : '') +
        '<div class="field"><label for="wt">Type</label><select id="wt" name="type" class="inp">' + options(LABELS.workoutType, o.workoutType || 'pilates') + '</select></div>' +
        '<div class="field"><label for="wd">Duration in minutes</label><input id="wd" name="durationMin" class="inp" type="number" min="1" max="600" value="' + (o.duration || 30) + '" inputmode="numeric" required></div>' +
        '<div class="field"><label for="we">Effort: <span id="wev">5</span> of 10</label><input id="we" name="effort" class="range" type="range" min="1" max="10" value="5" data-mirror="wev"></div>' +
        '<div class="field"><label for="wn">Notes</label><input id="wn" name="notes" class="inp" type="text" maxlength="120"></div>' +
        '<button class="pt-btn pt-btn-primary block" type="submit">Save workout</button></form>');
    }

    if (o.type === 'advice') return adviceSheet(o.taskId);

    // S1: three dot menu. Mood history is an addition: the phone tab bar has no Mood tab.
    if (o.type === 'menu') {
      const dark = store.getState().settings.theme === 'dark';
      const item = (icon, label, attrs, val, danger) => '<button class="lrow menu-item" role="menuitem" ' + attrs + '><span class="ic"' + (danger ? ' style="color: var(--period-ink)"' : '') + '>' + svg(icon) + '</span>' +
        '<span class="tx"><b' + (danger ? ' style="color: var(--period-ink)"' : '') + '>' + label + '</b></span>' + (val ? '<span class="val">' + val + '</span>' : '') + '</button>';
      return '<div class="scrim" data-act="close"></div><div class="pt-card menu-pop" role="menu" aria-label="Menu">' +
        item('moon', 'Mode', 'data-act="go" data-to="#/settings/mode"', dark ? 'Dark' : 'Light') +
        item('face', 'Mood history', 'data-act="go" data-to="#/mood"') +
        item('gear', 'Settings', 'data-act="go" data-to="#/settings"') +
        item('logout', 'Log out', 'data-act="open" data-type="logout"', null, true) + '</div>';
    }

    // S6, and the same dialog shape for delete and the About rows.
    const dialog = (icon, danger, title, body, buttons) => '<div class="scrim" data-act="close"></div><div class="pt-card dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">' +
      '<span class="dlg-ic"' + (danger ? ' style="color: var(--period-ink)"' : '') + '>' + svg(icon) + '</span><h2 id="dlg-title" class="t-title" style="margin: 0">' + title + '</h2>' +
      '<p class="t-sub" style="margin: 0">' + body + '</p><div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px">' + buttons + '</div></div>';

    if (o.type === 'logout') {
      return dialog('logout', true, 'Log out of Petal?', 'Your data stays saved on this device. You can come back any time.',
        '<button class="pt-btn pt-btn-primary block" data-act="logout">Log out</button><button class="pt-btn pt-btn-outline block" data-act="close">Stay logged in</button>');
    }
    if (o.type === 'delete') {
      return dialog('trash', true, 'Delete all your data?', 'This removes every log, answer and setting from this device. It cannot be undone. Export first if you want a copy.',
        '<button class="pt-btn pt-btn-primary block danger" data-act="delete-all">Delete everything</button><button class="pt-btn pt-btn-outline block" data-act="close">Keep my data</button>');
    }
    if (o.type === 'info') {
      const INFO = {
        about: ['info', 'About Petal', 'Petal 1.0, local build. A cycle aware planner for meals, workouts, mood and work. Everything you log is stored in this browser.'],
        help: ['help', 'Help and support', 'Help pages and a way to contact support arrive before launch.'],
        terms: ['shield', 'Terms and privacy policy', 'The full documents are being written. In short: your cycle data is never used for ads, and you can export or delete it any time.'],
      }[o.topic];
      return dialog(INFO[0], false, INFO[1], INFO[2], '<button class="pt-btn pt-btn-primary block" data-act="close">Close</button>');
    }
    return '';
  }

  /* ------------------------------------------------------------------ */
  /* Planner (P4 to P6), new task (P1), task check (P2, P3), trends (P7, P8) */
  /* ------------------------------------------------------------------ */

  const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmtShort(iso) { const p = parts(iso); return SHORT_DAYS[p.dow] + ' ' + p.d + ' ' + monthName(p.m, true); }
  function signed(n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0'; }
  function phaseKey(info) { return info.isOvulationDay || info.isFertile ? 'ovulation' : info.phase; }
  function phaseColor(info) { return info.phase === 'menstrual' ? 'var(--period)' : 'var(--' + phaseKey(info) + ')'; }
  function phaseText(info) { return info.isOvulationDay ? 'Ovulation' : info.isFertile ? 'Fertile window' : info.label; }

  function statsCard(title, score, withLink) {
    return '<section class="pt-card" style="margin-top: 12px; border-radius: 24px" aria-label="' + esc(title) + '">' +
      '<div style="display: flex; align-items: center; justify-content: space-between"><h2 class="t-head">' + esc(title) + '</h2>' +
      (withLink ? '<button class="linkbtn" data-act="go" data-to="#/goals/productivity">See trends</button>' : '') + '</div>' +
      '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px">' +
      '<div class="stat"><b style="color: var(--follicular-ink)">' + signed(score.done) + '</b><span>Done</span></div>' +
      '<div class="stat"><b style="color: var(--period-ink)">' + signed(-score.missed) + '</b><span>Not done</span></div>' +
      '<div class="stat" style="background: var(--surface-200); border: 2px solid var(--plum)"><b style="color: var(--plum)">' + signed(score.net) + '</b><span>Net score</span></div></div>' +
      '<p class="t-cap" style="margin-top: 12px">Each finished task adds 1 and logs what you did. Each missed task takes 1 away.</p></section>';
  }

  function taskRow(task, t) {
    const due = P.taskDate(task);
    let chk, score, next;
    if (task.status === 'done') { chk = '<span class="chk on">' + svg('tick') + '</span>'; score = '<span class="score pos">+1</span>'; next = 'not done'; }
    else if (task.status === 'missed') { chk = '<span class="chk miss">' + svg('close') + '</span>'; score = '<span class="score neg">−1</span>'; next = 'done'; }
    else { chk = '<span class="chk"></span>'; score = '<span class="score pend">' + (due === t ? 'Due' : 'Planned') + '</span>'; next = 'done'; }
    return '<article class="task"><button class="chk-btn" data-act="task" data-id="' + task.id + '" aria-label="Mark ' + esc(task.title) + ' as ' + next + '">' + chk + '</button>' +
      '<div class="tx"><b>' + esc(task.title) + '</b><span>' + fmtTime(task.dueAt) + ' · ' + LABELS.taskType[task.type] + (task.effort === 'deep' ? ' · Deep focus' : '') + (task.source === 'assistant' ? ' · Added by assistant' : '') + '</span></div>' + score + '</article>';
  }

  function plannerDay(t) {
    const d = ui.goalsDate;
    const tasks = store.select.tasksOn(d);
    const info = store.select.phaseFor(d);
    const title = d === t ? 'Productivity today' : 'Productivity on ' + fmtDay(d);
    return statsCard(title, P.productivityScore(tasks), true) +
      '<section style="margin-top: 16px; display: flex; flex-direction: column; gap: 8px">' +
      '<div class="mon" style="margin: 0"><button data-act="goals-step" data-d="-1" aria-label="Previous day">' + svg('back') + '</button><h2 class="t-head">' + esc(fmtLong(d)) + '</h2><button data-act="goals-step" data-d="1" aria-label="Next day">' + svg('next') + '</button></div>' +
      (info ? '<div>' + phaseChip(info, info.label + ', day ' + info.cycleDay) + '</div>' : '') +
      (tasks.length ? tasks.map((k) => taskRow(k, t)).join('') : '<p class="t-cap">Nothing planned for this day.</p>') + '</section>' +
      (info ? '<section class="pt-alt" style="margin-top: 12px; background: var(--surface-300)"><b>' + info.label + ' focus</b><span>' + esc(info.hints.work) + '. ' + PHASE_STORY[info.phase] + '</span></section>' : '');
  }

  function plannerWeek(t) {
    const ws = P.weekStartOf(ui.goalsDate);
    const days = store.select.productivityDays(ws, 7);
    const weekTasks = days.flatMap((day) => store.select.tasksOn(day.date));
    const rows = days.map((day) => {
      const p = parts(day.date);
      const tasks = store.select.tasksOn(day.date);
      const info = store.select.phaseFor(day.date);
      const isToday = day.date === t;
      const titles = tasks.slice(0, 3).map((k) => '<b style="font: 600 15px/22px var(--font-sans); color: var(--ink)">' + esc(k.title) + '</b>').join('') +
        (tasks.length > 3 ? '<span>' + (tasks.length - 3) + ' more</span>' : '') + (tasks.length ? '' : '<span>Nothing planned</span>');
      const phase = info ? '<span style="display: inline-flex; align-items: center; gap: 6px; margin-top: 2px"><i style="display: inline-block; width: 10px; height: 10px; border-radius: 9999px; background: ' + phaseColor(info) + '"></i>' + phaseText(info) + (isToday ? ', today' : '') + '</span>' : '';
      let score = '';
      if (day.done + day.missed > 0) score = '<span class="score ' + (day.net > 0 ? 'pos' : day.net < 0 ? 'neg' : 'pend') + '">' + signed(day.net) + '</span>';
      else if (day.pending) score = '<span class="score pend">Due</span>';
      return '<button class="wrow" data-act="goals-day" data-date="' + day.date + '"' + (isToday ? ' style="border: 2px solid var(--plum)"' : '') + ' aria-label="' + esc(fmtLong(day.date)) + ', ' + tasks.length + ' tasks">' +
        '<div class="wdate" style="background: var(--surface-300); color: var(--ink); width: 48px; height: 52px">' + SHORT_DAYS[p.dow] + '<b style="font-size: 18px; line-height: 22px">' + p.d + '</b></div>' +
        '<div class="tx" style="gap: 2px">' + titles + phase + '</div>' + score + '</button>';
    }).join('');
    return statsCard(ws === P.weekStartOf(t) ? 'Productivity this week' : 'Productivity that week', P.productivityScore(weekTasks), true) +
      '<section style="margin-top: 16px; display: flex; flex-direction: column; gap: 8px">' +
      '<div class="mon" style="margin: 0"><button data-act="goals-step" data-d="-7" aria-label="Previous week">' + svg('back') + '</button><h2 class="t-head">' + fmtRange(ws, P.addDays(ws, 6)) + '</h2><button data-act="goals-step" data-d="7" aria-label="Next week">' + svg('next') + '</button></div>' +
      rows + '</section>';
  }

  function plannerMonth(t) {
    const { y, m } = parts(ui.goalsDate);
    const grid = store.select.monthGrid(y, m);
    const first = y + '-' + String(m).padStart(2, '0') + '-01';
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const days = store.select.productivityDays(first, dim);
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    const cls = { menstrual: 'p', follicular: 'f', luteal: 'l' };
    const cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => '<span class="pt-cal-dow">' + d + '</span>').join('') + grid.map((g) => {
      if (!g.inMonth) return '<span class="cell2 blank"></span>';
      const day = byDate[g.date];
      const has = day.done + day.missed > 0;
      const c = g.date === t ? 'today' : !g.phase ? '' : g.isOvulationDay ? 'o' : g.isFertile ? 'fe' : cls[g.phase];
      const n = parts(g.date).d;
      return '<button class="cell2 ' + c + '" data-act="goals-day" data-date="' + g.date + '" aria-label="' + n + ' ' + MONTHS[m - 1] + (has ? ', net score ' + signed(day.net) : day.total ? ', ' + day.total + ' planned' : '') + '">' + n + '<small>' + (has ? signed(day.net) : day.total ? '·' : '') + '</small></button>';
    }).join('');
    const monthTasks = days.flatMap((d) => store.select.tasksOn(d.date));
    const isThisMonth = first.slice(0, 7) === t.slice(0, 7);
    return '<section class="pt-card" style="margin-top: 12px; padding: 12px; border-radius: 24px"><div class="mon">' +
      '<button data-act="goals-step" data-d="-1" aria-label="Previous month">' + svg('back') + '</button><b>' + MONTHS[m - 1] + ' ' + y + '</b><button data-act="goals-step" data-d="1" aria-label="Next month">' + svg('next') + '</button></div>' +
      '<div class="pt-cal" style="gap: 4px">' + cells + '</div>' +
      '<div class="pt-legend" style="margin-top: 12px"><span><i style="background: var(--period)"></i>Period</span><span><i style="background: var(--follicular)"></i>Follicular</span><span><i style="background: var(--ovulation)"></i>Ovulation</span><span><i style="background: var(--luteal)"></i>Luteal</span><span><i style="background: var(--action)"></i>Today</span></div>' +
      '<p class="t-cap" style="margin-top: 8px">The small number is each day’s net score. Tap a day to see its tasks.</p></section>' +
      statsCard(isThisMonth ? 'Productivity this month' : 'Productivity in ' + MONTHS[m - 1], P.productivityScore(monthTasks), true);
  }

  function planner() {
    const t = P.today(now());
    if (!ui.goalsDate) ui.goalsDate = t;
    const views = ['day', 'week', 'month'];
    const body = ui.goalsView === 'week' ? plannerWeek(t) : ui.goalsView === 'month' ? plannerMonth(t) : plannerDay(t);
    return '<div class="ph has-tabs"><div class="top" style="justify-content: space-between"><h1 class="t-title" style="margin: 0">Goals</h1>' +
      '<button class="addbtn" data-act="new-task" aria-label="Add task">' + svg('plus') + '</button></div>' +
      '<div style="margin-top: 12px"><div class="seg full" role="group" aria-label="View">' + views.map((v) =>
        '<button class="' + (ui.goalsView === v ? 'on' : '') + '" aria-pressed="' + (ui.goalsView === v) + '" data-act="goals-view" data-value="' + v + '">' + v.charAt(0).toUpperCase() + v.slice(1) + '</button>').join('') + '</div></div>' +
      body + tabs('goals') + '</div>';
  }

  function newTaskScreen() {
    const t = P.today(now());
    if (!ui.newTask) ui.newTask = { title: '', date: ui.goalsDate || t, time: '09:00', type: 'work', effort: 'medium', note: '' };
    const n = ui.newTask;
    const chips = (field, labels) => '<div class="chips">' + Object.keys(labels).map((v) => {
      const on = n[field] === v;
      return '<button class="opt' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="nt-set" data-field="' + field + '" data-value="' + v + '">' + (on ? svg('tick') : '') + labels[v] + '</button>';
    }).join('') + '</div>';
    const checks = store.select.can('taskCheck');
    return '<div class="ph"><div class="top" style="justify-content: space-between"><button class="back" data-act="go" data-to="#/goals" aria-label="Back">' + svg('back') + '</button></div>' +
      '<h1 class="t-title" style="margin-top: 16px">New task</h1><p class="t-sub">' + (checks ? 'Add it to your planner. Your assistant checks it against your phase.' : 'Add it to your planner. With Pro, your assistant also checks it against your phase.') + '</p>' +
      '<div class="sec" style="gap: 16px">' +
      '<div class="field"><label for="tt">Task</label><input id="tt" class="inp" type="text" data-bind="newTask.title" value="' + esc(n.title) + '" maxlength="80" autocomplete="off"></div>' +
      '<div class="grid2"><div class="field"><label for="dd">Day</label><input id="dd" class="inp" type="date" data-bind="newTask.date" value="' + n.date + '"></div>' +
      '<div class="field"><label for="tm">Time</label><input id="tm" class="inp" type="time" data-bind="newTask.time" value="' + n.time + '"></div></div>' +
      '<div class="field"><span class="field-label">Type</span>' + chips('type', LABELS.taskType) + '</div>' +
      '<div class="field"><span class="field-label">Effort</span>' + chips('effort', LABELS.effort) + '</div>' +
      '<div class="field"><label for="nt">Note, optional</label><textarea id="nt" class="area" style="min-height: 88px" data-bind="newTask.note" placeholder="What does done look like?" maxlength="500">' + esc(n.note) + '</textarea></div>' +
      '<p class="t-cap" id="err" role="alert" style="color: var(--period-ink)"></p></div>' +
      '<div class="foot"><button class="pt-btn pt-btn-primary block" data-act="save-task">Add task</button></div></div>';
  }

  // Assistant message after adding a task. Rule based, no AI call, always shows its basis.
  function adviceSheet(taskId) {
    const t = P.today(now());
    const task = store.getState().logs.tasks.find((k) => k.id === taskId);
    if (!task) return '';
    const a = store.select.taskAdvice(task);
    const info = a.info;
    const dayName = DAYS[parts(a.date).dow];
    const meta = fmtShort(a.date) + ' · ' + fmtTime(task.dueAt) + ' · ' + LABELS.taskType[task.type] + ' · ' + LABELS.effort[task.effort];
    const head = '<div style="display: flex; align-items: center; gap: 10px">' + LOGO.replace('width="24" height="24"', 'width="36" height="36"') + '<div style="display: flex; flex-direction: column"><b class="t-head">Assistant</b><span class="t-cap">About your new task</span></div></div>';
    let msg, chip = '', alts, basis, buttons;
    if (a.kind === 'caution') {
      const sameWeek = P.weekStartOf(a.date) === P.weekStartOf(t);
      const where = info.phase === 'menstrual' ? 'your period, when hormones are at their lowest and energy often dips.'
        : (info.isLateLuteal ? 'your late luteal phase' : 'your luteal phase') + ', when progesterone peaks and energy and focus often dip.';
      msg = '<span>' + (sameWeek ? 'Please go easy on this week. ' : '') + 'On ' + fmtShort(a.date) + ' you are likely in ' + where + '</span>' +
        '<span>Deep focus work fits your follicular phase better. It starts around ' + fmtDay(a.follicularStart) + '.</span>';
      alts = '<span><b>If</b> your energy logs stay steady, <b>then</b> keep it and start with a short outline.</span>' +
        '<span><b>If</b> you log tiredness' + (a.tired ? ' again' : '') + ', <b>then</b> move it to ' + fmtDay(a.suggestedDate) + '.</span>';
      basis = 'Based on: ' + info.label.toLowerCase() + ' day ' + info.cycleDay + ', ' + a.weekTaskCount + ' other ' + (a.weekTaskCount === 1 ? 'task' : 'tasks') + ' planned that week' + (a.moodLogged ? ', mood logged today' : '') + '. This is an estimate, not medical advice.';
      buttons = '<button class="pt-btn pt-btn-primary block" data-act="advice-move" data-id="' + task.id + '" data-date="' + a.suggestedDate + '">Move to ' + fmtDay(a.suggestedDate) + '</button>' +
        '<button class="pt-btn pt-btn-outline block" data-act="close">Keep on ' + dayName + '</button>';
    } else {
      const when = a.date === t ? 'today' : 'on ' + fmtShort(a.date);
      msg = '<span>You are likely at your peak ' + when + '. Estrogen and luteinizing hormone are high, so energy, confidence and communication are often at their best.</span>' +
        '<span>This is a good day for presentations, hard conversations and big asks. Go for it.</span>';
      chip = '<span class="chip chip-ovulation" style="height: 24px">Ovulation</span>';
      alts = '<span><b>If</b> you slept well, <b>then</b> schedule your hardest task before noon.</span>' +
        '<span><b>If</b> you slept under 6 hours, <b>then</b> keep this task and move admin work to another day.</span>';
      basis = 'Based on: ovulation day ' + (P.daysBetween(info.cycleStart, info.ovulationDate) + 1) + ', your ' + info.cycleLength + ' day cycle. This is an estimate, not medical advice.';
      buttons = '<button class="pt-btn pt-btn-primary block" data-act="close">Keep it on ' + dayName + '</button>' +
        '<button class="pt-btn pt-btn-outline block" data-act="new-task">Add another task</button>';
    }
    return '<div class="scrim" data-act="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="Assistant message"><div class="handle"></div>' + head +
      '<div class="pt-msg pt-msg-ai" style="max-width: 100%; display: flex; flex-direction: column; gap: 8px">' + msg + '</div>' +
      '<div class="task" style="box-shadow: none"><span class="chk"></span><div class="tx"><b>' + esc(task.title) + '</b><span>' + meta + '</span></div>' + chip + '</div>' +
      '<div class="pt-alt" style="background: var(--surface-300)">' + alts + '<span class="pt-src">' + basis + '</span></div>' +
      '<div style="display: flex; flex-direction: column; gap: 8px">' + buttons + '</div></section>';
  }

  // Bar chart in the P7/P8 style: positive bars above the zero line, negative below.
  function barChart(items, ariaLabel, showValues) {
    const left = 4, right = 322, zero = 93, span = 68.2;
    const slot = (right - left) / items.length, bw = Math.min(28, slot * 0.62);
    const max = Math.max(1, ...items.map((i) => Math.abs(i.value || 0)));
    const txt = (x, y, s, weight, fill) => '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="' + weight + '" fill="' + fill + '" style="font-family: var(--font-sans)">' + s + '</text>';
    let out = '<svg viewBox="0 0 326 192" width="100%" role="img" aria-label="' + esc(ariaLabel) + '">' +
      '<line x1="4" x2="322" y1="161.2" y2="161.2" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 4"/>' +
      '<line x1="4" x2="322" y1="24.8" y2="24.8" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 4"/>' +
      '<line x1="4" x2="322" y1="93" y2="93" stroke="var(--border-strong)" stroke-width="1.5"/>';
    items.forEach((it, i) => {
      const cx = left + slot * (i + 0.5);
      if (it.value != null) {
        const h = (Math.abs(it.value) / max) * span;
        const rx = Math.min(6, bw / 2, h / 2);
        if (it.value > 0) out += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + (zero - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + rx.toFixed(1) + '" fill="var(--luteal)"/>';
        if (it.value < 0) out += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + zero + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + rx.toFixed(1) + '" fill="var(--period)"/>';
        if (showValues) out += txt(cx, it.value < 0 ? zero + h + 13 : zero - h - 5, signed(it.value), 700, 'var(--ink)');
      }
      if (it.label) out += txt(cx, 188, it.label, 600, 'var(--ink-muted)');
    });
    return out + '</svg>';
  }

  function phaseStrip(dates) {
    const slot = 318 / dates.length;
    return '<svg viewBox="0 0 326 12" width="100%" height="12" preserveAspectRatio="none" role="img" aria-label="Cycle phases along the days shown">' + dates.map((d, i) => {
      const info = store.select.phaseFor(d);
      return info ? '<rect x="' + (4 + slot * i).toFixed(1) + '" y="0" width="' + (slot + 0.5).toFixed(1) + '" height="12" fill="' + phaseColor(info) + '"/>' : '';
    }).join('') + '</svg>';
  }

  const CHART_LEGEND = '<div class="pt-legend"><span><i style="background: var(--luteal)"></i>Positive, above the line</span><span><i style="background: var(--period)"></i>Negative, below the line</span></div>';
  const PHASE_LEGEND = '<div class="pt-legend"><span><i style="background: var(--period)"></i>Period</span><span><i style="background: var(--follicular)"></i>Follicular</span><span><i style="background: var(--ovulation)"></i>Ovulation</span><span><i style="background: var(--luteal)"></i>Luteal</span></div>';

  function completionLine(score, period) {
    const total = score.done + score.missed;
    return total ? Math.round((score.done / total) * 100) + '% of tasks completed, ' + score.done + ' of ' + total + '.' : 'No finished or missed tasks yet ' + period + '.';
  }

  function trendsDays(t, start, count, period, label) {
    const days = store.select.productivityDays(start, count);
    const score = days.reduce((s, d) => ({ done: s.done + d.done, missed: s.missed + d.missed, net: s.net + d.net }), { done: 0, missed: 0, net: 0 });
    const isWeek = count === 7;
    const items = days.map((d, i) => ({
      value: d.done + d.missed > 0 ? d.net : d.date > t ? null : 0,
      label: isWeek ? SHORT_DAYS[parts(d.date).dow] : (i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : ''),
      name: isWeek ? DAYS[parts(d.date).dow] : fmtDay(d.date),
    }));
    const aria = 'Net productivity score per day: ' + items.map((it) => it.name + ' ' + (it.value == null ? 'not yet' : it.value > 0 ? 'plus ' + it.value : it.value < 0 ? 'minus ' + -it.value : '0')).join(', ') + '.';

    let insight = '';
    const active = days.filter((d) => d.done + d.missed > 0);
    if (active.length >= 2) {
      const best = Math.max(...active.map((d) => d.net));
      const top = active.filter((d) => d.net === best);
      const names = top.map((d) => isWeek ? DAYS[parts(d.date).dow] : fmtDay(d.date));
      const info = store.select.phaseFor(top[0].date);
      const low = active.reduce((a, b) => (b.net < a.net ? b : a));
      insight = '<section class="pt-alt" style="margin-top: 12px; background: var(--surface-300)"><b>Your peak was ' + names.slice(0, 3).join(' and ') + '</b>' +
        (info ? '<span>' + phaseText(info) + ' days gave your highest scores ' + period + '.</span>' : '') +
        (low.net < 0 && isWeek ? '<span><b>If</b> ' + DAYS[parts(low.date).dow] + ' dips again next cycle, <b>then</b> move deep work earlier in the week and keep ' + DAYS[parts(low.date).dow] + 's for admin.</span>' : '') +
        '<span class="pt-src">Based on: ' + (score.done + score.missed) + ' finished or missed tasks ' + period + ' and your cycle phases.</span></section>';
    }
    return '<section class="pt-card" style="margin-top: 16px; border-radius: 24px"><div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px">' +
      '<div class="stat"><b style="color: var(--follicular-ink)">' + signed(score.done) + '</b><span>Done</span></div>' +
      '<div class="stat"><b style="color: var(--period-ink)">' + signed(-score.missed) + '</b><span>Not done</span></div>' +
      '<div class="stat" style="background: var(--surface-200); border: 2px solid var(--plum)"><b style="color: var(--plum)">' + signed(score.net) + '</b><span>Net score</span></div></div>' +
      '<p class="t-cap" style="margin-top: 12px">' + completionLine(score, period) + '</p></section>' +
      '<section class="chartbox" style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px">' +
      '<div style="display: flex; align-items: baseline; justify-content: space-between"><h2 class="t-head">Net score per day</h2><span class="t-cap">' + label + '</span></div>' +
      barChart(items, aria, isWeek) + '<div style="margin-top: -4px">' + phaseStrip(days.map((d) => d.date)) + '</div>' + PHASE_LEGEND + CHART_LEGEND + '</section>' + insight;
  }

  function trendsYear(t) {
    const y = parts(t).y;
    const months = store.select.productivityYear(y);
    const items = months.map((m) => ({ value: m.done + m.missed > 0 ? m.net : null, label: MONTHS[m.month - 1].charAt(0), name: MONTHS[m.month - 1] }));
    const aria = 'Net productivity score per month in ' + y + ': ' + items.map((it) => it.name + ' ' + (it.value == null ? 'not logged' : signed(it.value).replace('−', 'minus ').replace('+', 'plus '))).join(', ') + '.';
    const byPhase = store.select.productivityByPhase();
    const bars = P.PHASE_ORDER.map((p) => {
      const r = byPhase[p].completionRate;
      const pct = r == null ? null : Math.round(r * 100);
      const color = p === 'menstrual' ? 'var(--period)' : 'var(--' + p + ')';
      return '<div class="hbar"><span style="width: 84px">' + P.PHASES[p].label + '</span><div class="tr"><i style="width: ' + (pct || 0) + '%; background: ' + color + '"></i></div><span style="width: 56px; text-align: right">' + (pct == null ? 'No data' : pct + '%') + '</span></div>';
    }).join('');
    const ranked = P.PHASE_ORDER.filter((p) => byPhase[p].done + byPhase[p].missed >= 3).sort((a, b) => byPhase[b].completionRate - byPhase[a].completionRate);
    const insight = ranked.length >= 2
      ? '<section class="pt-alt" style="margin-top: 12px; background: var(--surface-300)"><b>You finish the most on ' + P.PHASES[ranked[0]].label.toLowerCase() + ' days</b>' +
        '<span>Plan big projects there and keep ' + P.PHASES[ranked[ranked.length - 1]].label.toLowerCase() + ' days lighter.</span>' +
        '<span class="pt-src">Based on: all tasks you finished or missed. This is an estimate, not medical advice.</span></section>'
      : '<p class="t-cap" style="margin-top: 12px">Phase patterns appear after a few finished or missed tasks in at least two phases.</p>';
    return '<section class="chartbox" style="margin-top: 16px; display: flex; flex-direction: column; gap: 10px">' +
      '<div style="display: flex; align-items: baseline; justify-content: space-between"><h2 class="t-head">Net score per month</h2><span class="t-cap">' + y + '</span></div>' +
      barChart(items, aria, true) + CHART_LEGEND + '</section>' +
      '<section class="chartbox" style="margin-top: 12px; display: flex; flex-direction: column; gap: 12px"><h2 class="t-head">Completion by phase</h2>' + bars + '</section>' + insight;
  }

  function trendsScreen() {
    const t = P.today(now());
    const back = '<div class="top" style="justify-content: space-between"><button class="back" data-act="go" data-to="#/goals" aria-label="Back">' + svg('back') + '</button></div><h1 class="t-title" style="margin-top: 16px">Productivity</h1>';
    if (!store.select.can('productivityTrends')) {
      return '<div class="ph">' + back + '<section class="pt-card" style="margin-top: 16px"><b class="t-head">Trends are part of Pro</b>' +
        '<p class="t-cap" style="margin-top: 4px">See your week, month and year, and how much you finish in each phase. Your daily score stays free on the Goals tab.</p>' +
        '<button class="pt-btn pt-btn-primary" data-act="go" data-to="#/tab/pro" style="margin-top: 12px">See Pro</button></section></div>';
    }
    const views = ['week', 'month', 'year'];
    let body;
    if (ui.trendsView === 'year') body = trendsYear(t);
    else if (ui.trendsView === 'month') {
      const { y, m } = parts(t);
      const first = y + '-' + String(m).padStart(2, '0') + '-01';
      body = trendsDays(t, first, new Date(Date.UTC(y, m, 0)).getUTCDate(), 'this month', MONTHS[m - 1] + ' ' + y);
    } else {
      const ws = P.weekStartOf(t);
      body = trendsDays(t, ws, 7, 'this week', fmtRange(ws, P.addDays(ws, 6), true));
    }
    return '<div class="ph">' + back +
      '<div style="margin-top: 12px"><div class="seg full" role="group" aria-label="View">' + views.map((v) =>
        '<button class="' + (ui.trendsView === v ? 'on' : '') + '" aria-pressed="' + (ui.trendsView === v) + '" data-act="trends-view" data-value="' + v + '">' + v.charAt(0).toUpperCase() + v.slice(1) + '</button>').join('') + '</div></div>' +
      body + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Workouts (W1 to W6)                                                 */
  /* ------------------------------------------------------------------ */

  const CATALOG = window.PetalCatalog;
  const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22" style="fill:none;stroke:var(--ink-muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M9 6l6 6-6 6"/></svg>';
  const WARN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/></svg>';
  const WORKOUT_TYPES_UI = {
    weights: { name: 'Weight training', desc: 'At the gym or with body weight', fig: 'barbell', to: '#/workout/weights' },
    pilates: { name: 'Pilates', desc: 'Core and control, low impact', fig: 'hundred', to: '#/workout/pilates-yoga' },
    yoga: { name: 'Yoga', desc: 'Mobility and recovery', fig: 'catCow', to: '#/workout/pilates-yoga' },
    running: { name: 'Running', desc: 'Timer with a pace target', fig: 'runner', to: '#/workout/run' },
  };
  const FIT_TAG = { ok: ['ok', 'Fits your phase'], care: ['care', 'Lighter loads today'], rest: ['warnt', 'Light work or rest today'], easy: ['easy', 'Easy pace only'] };
  const MOVE_SUB = {
    menstrual: 'Gentle movement suits today. Rest is a good choice too.',
    follicular: 'Energy is usually rising. A good time to build intensity.',
    ovulation: 'Energy is often at its highest. A good day for your hardest session.',
    luteal: 'Moderate effort and recovery suit today. Pick what you feel like doing.',
  };

  function fig(key) { return '<span class="fig"><svg viewBox="0 0 72 72" aria-hidden="true">' + CATALOG.FIGURES[key] + '</svg></span>'; }
  function joinAnd(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }
  function mmss(ms) { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function proPlan() { return store.select.can('phaseWorkouts') ? store.select.workoutPlan() : null; }
  function planBasis(plan, extra) {
    return 'Based on: ' + plan.info.label.toLowerCase() + ' day ' + plan.info.cycleDay + (plan.moodLogged ? ', mood logged today' : '') +
      (plan.yesterdayEffort != null ? ', effort ' + plan.yesterdayEffort + ' of 10 yesterday' : '') + (extra || '') + '.';
  }

  // W2 caution banner (full) and its short form on the exercise lists (W3, W4).
  function cautionBox(plan, full) {
    const logged = [];
    if (plan.signals.tired) logged.push('tiredness');
    if (plan.signals.bloated) logged.push('bloating');
    if (plan.signals.pain) logged.push('pain of ' + plan.pain + ' of 10');
    if (plan.signals.hardYesterday) logged.push('a hard session yesterday');
    const reason = plan.info.phase === 'luteal' ? 'progesterone in the luteal phase makes the same load feel harder'
      : plan.info.phase === 'menstrual' ? 'energy is often lowest during your period' : 'your body may need an easier day';
    const why = logged.length ? 'You logged ' + joinAnd(logged) + ', and ' + reason + '.' : reason.charAt(0).toUpperCase() + reason.slice(1) + '.';
    const title = plan.cap <= 2 ? 'Keep it light or rest today' : 'Heavy lifting is not advised today';
    const body = full
      ? '<p>' + why + '</p><p><b class="ifb">If</b> you feel strong after a 10 minute warm-up, <b class="ifb">then</b> use about ' + plan.loadPercent + '% of your usual loads. <b class="ifb">If</b> you feel dizzy or have sharp pain, <b class="ifb">then</b> stop.</p><span class="pt-src">' + planBasis(plan) + '</span>'
      : '<p>Lighter loads are listed below. This is an estimate, not medical advice.</p>';
    return '<section class="warn" aria-label="Training caution"><span class="wi">' + WARN_ICON + '</span><div style="display: flex; flex-direction: column; gap: ' + (full ? 6 : 4) + 'px"><b>' + title + '</b>' + body + '</div></section>';
  }

  function strengthNote(plan) {
    const peak = plan.info.phase === 'follicular' || plan.info.phase === 'ovulation';
    return '<section class="pt-alt" style="background: var(--surface-300)"><b>' + (peak ? 'Strength often peaks now' : 'Moderate loads suit today') + '</b>' +
      '<span>' + (peak ? '<b>If</b> your warm-up feels good, <b>then</b> add a little load or one more set. Keep your form strict.'
        : '<b>If</b> a set feels harder than usual, <b>then</b> drop the load by 10% rather than pushing through.') + '</span>' +
      '<span class="pt-src">' + planBasis(plan, '. This is an estimate, not medical advice') + '</span></section>';
  }

  function workoutTop(back, label) {
    return '<div class="top"><button class="back" data-act="go" data-to="' + back + '" aria-label="Back">' + svg('back') + '</button><span class="steplab">' + label + '</span></div>';
  }

  function workoutHome() {
    const t = P.today(now());
    const plan = proPlan();
    const info = store.select.currentPhase();
    const order = plan ? plan.types : ['weights', 'pilates', 'yoga', 'running'].map((key) => ({ key }));
    const sub = !info ? 'Pick what you feel like doing.' : info.isLateLuteal ? 'Gentler effort suits the end of your cycle. Pick what you feel like doing.' : MOVE_SUB[info.phase];
    const cards = order.map(({ key, fit }) => {
      const w = WORKOUT_TYPES_UI[key];
      const desc = key === 'running' && plan ? (plan.run.pace === 'easy' ? 'Timer with an easy pace target' : 'Timer with a steady pace target') : w.desc;
      const tag = fit ? '<span class="tag ' + FIT_TAG[fit][0] + '">' + FIT_TAG[fit][1] + '</span>' : '';
      return '<button class="wtype" data-act="go" data-to="' + w.to + '">' + fig(w.fig) + '<span class="tx"><b>' + w.name + '</b><span class="d">' + desc + '</span>' + tag + '</span>' + CHEVRON + '</button>';
    }).join('');

    const ws = P.weekStartOf(t);
    const all = store.getState().logs.workouts.slice().sort((a, b) => b.date.localeCompare(a.date));
    const thisWeek = all.filter((w) => w.date >= ws && w.date <= P.addDays(ws, 6));
    const minutes = thisWeek.reduce((s, w) => s + w.durationMin, 0);
    const recent = all.slice(0, 5).map((w) => '<div class="lrow"><span class="ic">' + svg('dumbbell') + '</span><div class="tx"><b>' + LABELS.workoutType[w.type] + '</b><span>' + fmtShort(w.date) + ' · ' + w.durationMin + ' minutes</span></div><span class="val">Effort ' + w.effort + ' of 10</span></div>').join('');

    return '<div class="ph has-tabs"><div class="top" style="justify-content: space-between"><h1 class="t-title" style="margin: 0">Workout</h1>' + (info ? phaseChip(info, info.label + ', day ' + info.cycleDay) : '') + '</div>' +
      '<p class="t-sub">' + sub + '</p>' +
      '<div class="sec" style="gap: 12px; margin-top: 16px">' + cards + '</div>' +
      '<p class="t-cap" style="margin-top: 12px">' + (plan ? 'Ranked by your phase, today’s mood log and the workouts you chose in setup. This is an estimate, not medical advice.'
        : 'Phase matched picks and caution notes are part of Pro. Every exercise is still open to you.') + '</p>' +
      '<section class="pt-card" style="margin-top: 16px"><div style="display: flex; align-items: baseline; justify-content: space-between"><h2 class="t-head">This week</h2><span class="t-cap">' + thisWeek.length + (thisWeek.length === 1 ? ' workout, ' : ' workouts, ') + minutes + ' minutes</span></div>' +
      (recent ? '<div style="margin-top: 4px">' + recent + '</div>' : '<p class="t-cap" style="margin-top: 4px">No workouts logged yet. Finish one here or log it from the dashboard.</p>') + '</section>' +
      tabs('workout') + '</div>';
  }

  function weightsScreen() {
    const plan = proPlan();
    const note = plan ? (plan.caution ? cautionBox(plan, true) : strengthNote(plan)) : '';
    const gymDesc = plan && plan.caution ? 'Machines and light free weights, planned for today' : 'Machines and free weights';
    return '<div class="ph">' + workoutTop('#/workout', 'Workout') + '<h1 class="t-title" style="margin-top: 16px">Weight training</h1>' +
      '<div class="sec" style="gap: 16px; margin-top: 16px">' + note + '<h2 class="t-head">Where are you training?</h2>' +
      '<button class="wtype" data-act="go" data-to="#/workout/weights/gym">' + fig('barbell') + '<span class="tx"><b>At the gym</b><span class="d">' + gymDesc + '</span></span>' + CHEVRON + '</button>' +
      '<button class="wtype" data-act="go" data-to="#/workout/weights/bodyweight">' + fig('squat') + '<span class="tx"><b>Body weight</b><span class="d">No equipment, at home or anywhere</span></span>' + CHEVRON + '</button></div></div>';
  }

  function exerciseCard(e, session) {
    const inner = fig(e.figure) + '<div class="tx"><b>' + esc(e.name) + '</b><p>' + esc(e.description) + '</p><div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px">' +
      e.muscles.map((m) => '<span class="mus">' + esc(m) + '</span>').join('') + '<span class="mus dose">' + esc(e.dose) + '</span></div></div>';
    if (!session) return '<article class="ex">' + inner + '</article>';
    const on = session.done.includes(e.slug);
    return '<button class="ex ex-btn' + (on ? ' on' : '') + '" data-act="session-ex" data-value="' + e.slug + '" aria-pressed="' + on + '">' + inner +
      '<span class="chk' + (on ? ' on' : '') + '" style="align-self: center">' + (on ? svg('tick') : '') + '</span></button>';
  }

  function sessionFoot(kind) {
    const s = ui.session && ui.session.screen === location.hash ? ui.session : null;
    if (!s) return '<div class="foot"><button class="pt-btn pt-btn-primary block" data-act="session-start" data-kind="' + kind + '">' + (kind === 'weights' ? 'Start workout' : 'Start session') + '</button></div>';
    return '<div class="foot"><p class="t-cap" style="text-align: center">Tap each exercise as you finish it. <span data-clock>' + mmss(Date.now() - s.startedAt) + '</span> so far.</p>' +
      '<button class="pt-btn pt-btn-primary block" data-act="session-finish">Finish and log</button><button class="pt-btn pt-btn-text block" data-act="session-cancel">Cancel session</button></div>';
  }

  function listScreen(location) {
    const plan = proPlan();
    const session = ui.session && ui.session.screen === window.location.hash ? ui.session : null;
    const list = P.exercisesFor(CATALOG.EXERCISES, location, plan);
    const title = location === 'gym' ? 'At the gym' : 'Body weight';
    const basis = plan ? 'Recommended for ' + plan.info.label.toLowerCase() + ' day ' + plan.info.cycleDay + (location === 'gym' ? (plan.caution ? ', with lighter loads and a controlled tempo.' : '.') : '. No equipment needed.')
      : 'All exercises. Phase matched picks are part of Pro.';
    return '<div class="ph">' + workoutTop('#/workout/weights', 'Weight training') + '<h1 class="t-title" style="margin-top: 16px">' + title + '</h1>' +
      '<div class="sec" style="gap: 12px; margin-top: 16px">' + (plan && plan.caution ? cautionBox(plan, false) : '') +
      '<p class="pt-src">' + basis + '</p>' + list.map((e) => exerciseCard(e, session)).join('') + '</div>' + sessionFoot('weights') + '</div>';
  }

  function pilatesYogaScreen() {
    const plan = proPlan();
    const session = ui.session && ui.session.screen === location.hash ? ui.session : null;
    const yoga = P.exercisesFor(CATALOG.EXERCISES, 'yoga', plan);
    const pilates = P.exercisesFor(CATALOG.EXERCISES, 'pilates', plan);
    let sub = 'Choose one or mix them.', basis = 'All exercises. Phase matched picks are part of Pro.';
    if (plan) {
      const gentle = plan.info.phase === 'menstrual' || plan.info.phase === 'luteal';
      sub = (gentle ? 'Both suit the ' + plan.info.label.toLowerCase() + ' phase.' : 'Good for recovery days between harder sessions.') + ' Choose one or mix them.';
      const logged = [plan.signals.bloated && 'bloating', plan.signals.tired && 'tiredness'].filter(Boolean);
      basis = 'Recommended for ' + plan.info.label.toLowerCase() + ' day ' + plan.info.cycleDay + (logged.length ? ', ' + joinAnd(logged) + ' logged today.' : '.');
    }
    return '<div class="ph">' + workoutTop('#/workout', 'Workout') + '<h1 class="t-title" style="margin-top: 16px">Pilates and yoga</h1><p class="t-sub">' + sub + '</p>' +
      '<div class="sec" style="gap: 12px; margin-top: 16px"><p class="pt-src">' + basis + '</p>' +
      '<h2 class="t-head">Yoga</h2>' + yoga.map((e) => exerciseCard(e, session)).join('') +
      '<h2 class="t-head" style="margin-top: 8px">Pilates</h2>' + pilates.map((e) => exerciseCard(e, session)).join('') + '</div>' + sessionFoot('mixed') + '</div>';
  }

  function runElapsed() { const r = ui.run; return !r ? 0 : r.accMs + (r.running ? Date.now() - r.startedAt : 0); }

  function runScreen() {
    const plan = proPlan();
    const run = plan ? plan.run : { minMinutes: 20, targetMinutes: 30, pace: 'steady' };
    const sub = plan ? (run.pace === 'easy' ? 'Easy pace today. ' : 'A steady pace suits today. ') + 'Aim for ' + run.minMinutes + ' to ' + run.targetMinutes + ' minutes.' : 'Aim for 20 to 30 minutes, or set your own pace.';
    const r = ui.run;
    const elapsed = runElapsed();
    const circ = 2 * Math.PI * 114;
    const frac = Math.min(1, elapsed / (run.targetMinutes * 60000));
    const controls = !r
      ? '<span style="min-width: 112px"></span><button class="bigbtn" data-act="run-toggle" aria-label="Start timer">' + PLAY + '</button><span style="min-width: 112px"></span>'
      : '<button class="pt-btn pt-btn-outline" data-act="run-finish" style="height: 56px; min-width: 112px">Finish</button><button class="bigbtn" data-act="run-toggle" aria-label="' + (r.running ? 'Pause timer' : 'Resume timer') + '">' + (r.running ? PAUSE : PLAY) + '</button><span style="min-width: 112px"></span>';
    let note = '';
    if (plan) {
      const p = plan.info.phase;
      const head = run.pace === 'steady' ? 'A good day to push a little' : p === 'menstrual' ? 'Keep it gentle' : 'Keep it conversational';
      const why = run.pace === 'steady' ? 'Rising estrogen supports endurance. <b>If</b> you feel good after 10 minutes, <b>then</b> add a few faster minutes.'
        : p === 'menstrual' ? 'Energy is often lowest on period days. A short easy run or a walk both count.'
          : p === 'luteal' ? 'Progesterone raises your heart rate at the same pace, so the same run feels harder now.' : 'You logged signs of fatigue today, so an easy pace is the safer choice.';
      note = '<section class="pt-alt" style="margin-top: 32px; background: var(--surface-300)"><b>' + head + '</b><span>' + why + '</span>' +
        (run.pace === 'easy' ? '<span><b>If</b> you can speak in full sentences, <b>then</b> your pace is right. <b>If</b> you cannot, <b>then</b> slow down or walk for 2 minutes.</span>' : '') +
        '<span class="pt-src">Based on: ' + plan.info.label.toLowerCase() + ' day ' + plan.info.cycleDay + (plan.signals.tired ? ', tiredness logged today' : '') + (store.getState().profile.isMom ? ', a shorter target for busy days' : '') + '.</span></section>';
    }
    return '<div class="ph">' + workoutTop('#/workout', 'Workout') + '<h1 class="t-title" style="margin-top: 16px">Running</h1><p class="t-sub">' + sub + '</p>' +
      '<div style="position: relative; width: 260px; height: 260px; margin: 32px auto 0"><svg viewBox="0 0 260 260" width="260" height="260" role="img" aria-label="Progress toward the ' + run.targetMinutes + ' minute target">' +
      '<circle cx="130" cy="130" r="114" fill="none" stroke="var(--surface-300)" stroke-width="16"/>' +
      '<circle data-ring data-target="' + run.targetMinutes + '" cx="130" cy="130" r="114" fill="none" stroke="var(--plum)" stroke-width="16" stroke-linecap="round" transform="rotate(-90 130 130)" stroke-dasharray="' + (circ * frac).toFixed(1) + ' ' + circ.toFixed(1) + '" style="opacity: ' + (frac > 0 ? 1 : 0) + '"/></svg>' +
      '<div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center"><span role="timer" data-clock="run" style="font: 800 64px/64px var(--font-sans); letter-spacing: -0.02em">' + mmss(elapsed) + '</span><span class="t-cap">of ' + run.targetMinutes + ' minute target</span></div></div>' +
      '<div style="display: flex; align-items: center; justify-content: center; gap: 24px; margin-top: 32px">' + controls + '</div>' + note + '</div>';
  }
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>';

  // Updates running clocks once a second without re-rendering the page.
  setInterval(() => {
    document.querySelectorAll('[data-clock]').forEach((el) => {
      el.textContent = el.dataset.clock === 'run' ? mmss(runElapsed()) : ui.session ? mmss(Date.now() - ui.session.startedAt) : el.textContent;
    });
    const ring = document.querySelector('[data-ring]');
    if (ring && ui.run) {
      const circ = 2 * Math.PI * 114;
      const frac = Math.min(1, runElapsed() / (Number(ring.dataset.target) * 60000));
      ring.setAttribute('stroke-dasharray', (circ * frac).toFixed(1) + ' ' + circ.toFixed(1));
      ring.style.opacity = frac > 0 ? 1 : 0;
    }
  }, 1000);

  /* ------------------------------------------------------------------ */
  /* Mood history (M1, M2, plus a year view)                             */
  /* ------------------------------------------------------------------ */

  function moodInsight() {
    if (!store.select.can('moodPatterns')) return '<p class="t-cap" style="margin-top: 12px">Pattern alerts by phase are part of Pro.</p>';
    const mp = store.select.moodPhases();
    const ranked = P.PHASE_ORDER.filter((p) => mp.phases[p].days >= 3).sort((a, b) => mp.phases[a].average - mp.phases[b].average);
    if (ranked.length < 2) return '<p class="t-cap" style="margin-top: 12px">Patterns by phase appear after about 3 logged days in at least two phases.</p>';
    const low = ranked[0], high = ranked[ranked.length - 1];
    const clear = mp.phases[high].average - mp.phases[low].average >= 1;
    const name = (p) => P.PHASES[p].label.toLowerCase();
    return '<section class="pt-alt" style="margin-top: 12px; background: var(--surface-300)">' +
      '<b>' + (clear ? 'Your moods follow your phases' : 'No strong phase pattern yet') + '</b>' +
      '<span>' + (clear ? 'Your mood is usually lowest in your ' + name(low) + ' phase and highest in your ' + name(high) + ' phase.' +
        (low === 'luteal' ? ' Mood tends to dip 7 to 10 days before your period and lift again in the follicular phase as estrogen rises.' : '')
        : 'Your mood looks fairly steady across your cycle so far.') + '</span>' +
      '<span><b>If</b> a dip comes with strong pain or lasts past day 2 of your period, <b>then</b> mention it to a clinician.</span>' +
      '<span class="pt-src">Based on: your mood logs from ' + (mp.cycles === 1 ? '1 cycle' : 'the last ' + mp.cycles + ' cycles') + '. This is an estimate, not medical advice.</span></section>';
  }

  function moodEntries() {
    const logs = store.getState().logs.moods.map((m, i) => [m, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).slice(0, 10);
    if (!logs.length) return '<p class="t-cap">No moods logged yet.</p>';
    return logs.map(([m]) => {
      const p = parts(m.date);
      const info = store.select.phaseFor(m.date);
      const s = P.moodScore(m.moods).chart;
      return '<div class="entry"><div class="d">' + SHORT_DAYS[p.dow] + '<b>' + p.d + '</b></div><div style="flex: 1; display: flex; flex-direction: column; gap: 6px">' +
        '<div style="display: flex; gap: 6px; flex-wrap: wrap">' + m.moods.map((k) => '<span class="mus">' + P.MOODS[k].label + '</span>').join('') + '</div>' +
        (m.note ? '<p class="t-cap">' + esc(m.note) + '</p>' : '') +
        (info ? '<span class="chip chip-' + info.phase + '" style="align-self: flex-start; height: 24px">' + info.label + '</span>' : '') + '</div>' +
        '<span class="score ' + (s > 0 ? 'pos' : s < 0 ? 'neg' : 'pend') + '" aria-label="Mood score ' + signed(s) + '">' + signed(s) + '</span></div>';
    }).join('');
  }

  function moodHistory() {
    const t = P.today(now());
    const view = ui.moodView;
    const views = ['week', 'month', 'year'];
    const scoreName = (v) => (v == null ? 'not logged' : v > 0 ? 'plus ' + v : v < 0 ? 'minus ' + -v : '0');
    let chart;
    if (view === 'year') {
      const y = parts(t).y;
      const months = store.select.moodYear(y);
      const items = months.map((m) => ({ value: m.average, label: MONTHS[m.month - 1].charAt(0), name: MONTHS[m.month - 1] }));
      const mp = store.select.moodPhases();
      const phaseItems = P.PHASE_ORDER.map((p) => ({ value: mp.phases[p].average, label: p === 'menstrual' ? 'Period' : P.PHASES[p].label, name: P.PHASES[p].label }));
      chart = '<section class="chartbox" style="margin-top: 16px; display: flex; flex-direction: column; gap: 10px">' +
        '<div style="display: flex; align-items: baseline; justify-content: space-between"><h2 class="t-head">Average mood per month</h2><span class="t-cap">' + y + '</span></div>' +
        barChart(items, 'Average mood score per month in ' + y + ': ' + items.map((i) => i.name + ' ' + scoreName(i.value)).join(', ') + '.', true) + CHART_LEGEND + '</section>' +
        '<section class="chartbox" style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px"><h2 class="t-head">Average mood by phase</h2>' +
        barChart(phaseItems, 'Average mood score by phase: ' + phaseItems.map((i) => i.name + ' ' + scoreName(i.value)).join(', ') + '.', true) + '</section>';
    } else {
      const isWeek = view === 'week';
      const { y, m } = parts(t);
      const start = isWeek ? P.addDays(t, -6) : y + '-' + String(m).padStart(2, '0') + '-01';
      const count = isWeek ? 7 : new Date(Date.UTC(y, m, 0)).getUTCDate();
      const days = store.select.moodDays(start, count);
      const items = days.map((d, i) => ({
        value: d.logged ? d.chart : null,
        label: isWeek ? SHORT_DAYS[parts(d.date).dow] : (i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : ''),
        name: isWeek ? DAYS[parts(d.date).dow] : fmtDay(d.date),
      }));
      chart = '<section class="chartbox" style="margin-top: 16px; display: flex; flex-direction: column; gap: 10px">' +
        '<div style="display: flex; align-items: baseline; justify-content: space-between"><h2 class="t-head">Mood score</h2><span class="t-cap">' + (isWeek ? fmtRange(start, t) : MONTHS[m - 1] + ' ' + y) + '</span></div>' +
        barChart(items, 'Mood score per day: ' + items.map((i) => i.name + ' ' + scoreName(i.value)).join(', ') + '.', isWeek) +
        '<div style="margin-top: -4px">' + phaseStrip(days.map((d) => d.date)) + '</div>' + PHASE_LEGEND + CHART_LEGEND + '</section>';
    }
    return '<div class="ph"><div class="top" style="justify-content: space-between"><button class="back" data-act="go" data-to="#/" aria-label="Back">' + svg('back') + '</button>' +
      '<button class="pt-btn pt-btn-secondary" data-act="go" data-to="#/mood/new" style="height: 44px; padding: 0 16px">' + svg('plus', ' width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"') + 'Log mood</button></div>' +
      '<h1 class="t-title" style="margin-top: 16px">Mood</h1>' +
      '<div style="margin-top: 16px"><div class="seg full" role="group" aria-label="View">' + views.map((v) =>
        '<button class="' + (view === v ? 'on' : '') + '" aria-pressed="' + (view === v) + '" data-act="mood-view" data-value="' + v + '">' + v.charAt(0).toUpperCase() + v.slice(1) + '</button>').join('') + '</div></div>' +
      chart + moodInsight() +
      '<section style="margin-top: 16px"><h2 class="t-head">Recent logs</h2>' + moodEntries() + '</section></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Settings (S2 to S5), notifications, privacy, welcome back           */
  /* ------------------------------------------------------------------ */

  const ROW_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" style="flex: none; fill: none; stroke: var(--ink-muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round"><path d="M9 6l6 6-6 6"/></svg>';

  function settingsRow(icon, title, sub, attrs, opts) {
    const o = opts || {};
    return '<button class="lrow set-row" ' + (attrs || 'disabled') + '><span class="ic">' + svg(icon) + '</span><span class="tx"><b' + (o.danger ? ' style="color: var(--period-ink)"' : '') + '>' + title + '</b>' +
      (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span>' + (o.val ? '<span class="val">' + o.val + '</span>' : attrs ? ROW_CHEVRON : '') + '</button>';
  }
  function settingsGroup(title, rows) {
    return '<section style="margin-top: 20px"><h2 class="t-head" style="margin-bottom: 8px">' + title + '</h2><div class="pt-card" style="padding: 4px 16px; border-radius: 24px">' + rows.join('') + '</div></section>';
  }
  function subPage(title, back, sub) {
    return '<div class="top" style="justify-content: space-between"><button class="back" data-act="go" data-to="' + back + '" aria-label="Back">' + svg('back') + '</button></div>' +
      '<h1 class="t-title" style="margin-top: 16px">' + title + '</h1>' + (sub ? '<p class="t-sub">' + sub + '</p>' : '');
  }
  function switchCard(id, icon, title, sub, on, attrs) {
    return '<div class="row-card">' + (icon ? '<span class="ic round-ic">' + svg(icon) + '</span>' : '') + '<div class="tx"><b id="' + id + '">' + title + '</b><span>' + sub + '</span></div>' +
      '<button class="switch" role="switch" aria-checked="' + on + '" aria-labelledby="' + id + '" ' + attrs + '></button></div>';
  }

  function settingsScreen() {
    const s = store.getState();
    const p = s.profile, c = s.cycle, h = s.health;
    const initial = (p.displayName || 'P').charAt(0).toUpperCase();
    const body = [p.heightCm ? Math.round(p.heightCm) + ' cm' : null, p.weightKg ? Math.round(p.weightKg) + ' kg' : null, { loss: 'weight loss', gain: 'gain', maintain: 'maintenance' }[h.goal]].filter(Boolean).join(', ');
    const diet = h.dietStyles.map((d) => LABELS.dietStyles[d]).concat(h.allergies.map((a) => (LABELS.allergies[a] || a).toLowerCase())).join(', ').replace(/^./, (x) => x.toUpperCase());
    const life = [p.occupation ? LABELS.occupation[p.occupation] : null, p.isMom ? 'mom' : null].filter(Boolean).join(', ');
    const edit = (step) => 'data-act="edit-step" data-step="' + step + '"';
    return '<div class="ph">' + subPage('Settings', '#/') +
      '<section class="pt-card" style="margin-top: 16px; border-radius: 32px; display: flex; align-items: center; gap: 16px" aria-label="Profile">' +
      '<div style="width: 64px; height: 64px; flex: none; border-radius: 96px 0 96px 0; background: var(--surface-300); border: 2px solid var(--border-strong); display: flex; align-items: center; justify-content: center; font: 800 28px/1 var(--font-sans); color: var(--plum)">' + esc(initial) + '</div>' +
      '<div style="flex: 1; display: flex; flex-direction: column; min-width: 0"><b class="t-head">' + esc(p.displayName) + '</b><span class="t-cap">@' + esc(p.username) + '</span><span class="t-cap">Saved on this device</span></div>' +
      '<button class="ico" ' + edit(1) + ' aria-label="Edit profile">' + svg('edit') + '</button></section>' +
      settingsGroup('Your profile', [
        settingsRow('user', 'Personal information', 'Name and username', edit(1)),
        settingsRow('ruler', 'Body and goals', body || 'Add height and weight', edit(4)),
        settingsRow('drop', 'Cycle settings', c.cycleLength + ' day cycle, ' + c.periodLength + ' day period', edit(2)),
        settingsRow('face', 'Pain and flow', 'Pain ' + c.typicalPain + ' of 10, ' + c.typicalFlow + ' flow', edit(3)),
        settingsRow('leaf', 'Diet and allergies', diet || 'No restrictions set', edit(5)),
        settingsRow('dumbbell', 'Activity and workouts', P.ACTIVITY_TIERS[p.activityTier].label, edit(6)),
        settingsRow('briefcase', 'Life and work', life || 'Occupation and family', edit(7)),
      ]) +
      settingsGroup('Account', [
        settingsRow('crown', 'Subscription', s.settings.plan === 'pro' ? 'Pro preview on this device' : 'Free plan, upgrade to Pro', 'data-act="go" data-to="#/settings/subscription"'),
        settingsRow('link', 'Connected accounts', 'Arrives with sign in', null),
        settingsRow('bell', 'Notifications', s.settings.notifications.enabled ? 'Reminders on' : 'Reminders off', 'data-act="go" data-to="#/settings/notifications"'),
      ]) +
      settingsGroup('Privacy and data', [
        settingsRow('shield', 'Privacy settings', 'Choose what the assistant can use', 'data-act="go" data-to="#/settings/privacy"'),
        settingsRow('download', 'Export my data', 'One tap, as JSON and CSV files', 'data-act="export"'),
        settingsRow('trash', 'Delete my data', 'One tap, permanent', 'data-act="open" data-type="delete"', { danger: true }),
      ]) +
      '<p class="t-cap" style="margin-top: 8px">Your cycle data is never used to show ads.</p>' +
      settingsGroup('About Petal', [
        settingsRow('info', 'About the app', 'Version 1.0', 'data-act="open" data-type="info" data-topic="about"'),
        settingsRow('help', 'Help and support', '', 'data-act="open" data-type="info" data-topic="help"'),
        settingsRow('shield', 'Terms and privacy policy', '', 'data-act="open" data-type="info" data-topic="terms"'),
      ]) + '</div>';
  }

  function modeScreen() {
    const dark = store.getState().settings.theme === 'dark';
    const preview = (theme, bg, bar, card, label) => {
      const on = (theme === 'dark') === dark;
      return '<button class="mode-tile" data-act="set-theme" data-value="' + theme + '" aria-pressed="' + on + '"><div style="height: 120px; border-radius: 24px; background: ' + bg + '; border: 2px solid ' + (on ? 'var(--plum)' : 'var(--border)') + '; padding: 12px; display: flex; flex-direction: column; gap: 8px">' +
        '<div style="height: 16px; width: 60%; border-radius: 9999px; background: ' + bar + '; opacity: .9"></div><div style="flex: 1; border-radius: 16px; background: ' + card + '"></div>' +
        '<div style="display: flex; gap: 6px">' + ['#f26b6b', '#8fd694', '#ffd24a', '#8ec5f0'].map((col) => '<i style="width: 12px; height: 12px; border-radius: 9999px; background: ' + col + '"></i>').join('') + '</div></div>' +
        '<span class="t-cap" style="text-align: center;' + (on ? ' color: var(--plum); font-weight: 700' : '') + '">' + label + '</span></button>';
    };
    return '<div class="ph">' + subPage('Mode', ui.settingsBack, 'Choose how Petal looks. Phase colors stay the same in both modes.') +
      '<div style="margin-top: 24px">' + switchCard('dm', 'moon', 'Dark mode', (dark ? 'On' : 'Off') + '. Easier on the eyes at night.', dark, 'data-act="theme"') + '</div>' +
      '<div style="display: flex; gap: 12px; margin-top: 24px">' + preview('light', '#fff6fa', '#a01878', '#ffffff', 'Light') + preview('dark', '#1a0f18', '#f08ac4', '#261623', 'Dark') + '</div>' +
      '<p class="t-cap" style="margin-top: 16px">Your choice is saved to this device.</p></div>';
  }

  function subscriptionScreen() {
    const pro = store.getState().settings.plan === 'pro';
    return '<div class="ph">' + subPage('Subscription', '#/settings') +
      '<section class="pt-card" style="margin-top: 16px; border-radius: 32px; border: 2px solid var(--plum)">' +
      '<div style="display: flex; align-items: center; justify-content: space-between"><h2 class="t-head">' + (pro ? 'Petal Pro' : 'Petal Free') + '</h2><span class="chip" style="background: var(' + (pro ? '--ovulation' : '--follicular') + ')">' + (pro ? 'Preview' : 'Active') + '</span></div>' +
      '<div style="display: flex; align-items: baseline; gap: 6px; margin-top: 4px"><span style="font: 800 32px/38px var(--font-sans); color: var(--plum)">' + (pro ? '$17' : '$0') + '</span><span class="t-sub" style="margin: 0">per month</span></div>' +
      '<p class="t-cap" style="margin-top: 4px">' + (pro ? 'Billing is not connected yet, so nothing is charged. The $17 price is still to be confirmed.' : 'Log everything, phase based meal ideas, your own workouts and a basic planner.') + '</p></section>' +
      '<div style="margin-top: 16px">' + switchCard('pp', 'crown', 'Preview Pro features', 'Unlocks Pro screens on this device only, for testing before billing exists.', pro, 'data-act="toggle-pro"') + '</div>' +
      settingsGroup('Billing', [settingsRow('card', 'Payment method', 'Not set up', null), settingsRow('cal', 'Next payment', 'None', null)]) +
      settingsGroup('History', ['<p class="t-cap" style="padding: 12px 0">No payments yet.</p>']) +
      '<div class="foot" style="padding-top: 24px"><button class="pt-btn pt-btn-outline block" data-act="go" data-to="#/tab/pro">See plans</button>' +
      '<p class="t-cap" style="text-align: center">When billing is live, cancelling keeps Pro until the end of the billing period, then switches to Free.</p></div></div>';
  }

  function notificationsScreen() {
    const n = store.getState().settings.notifications;
    const supported = typeof Notification !== 'undefined';
    const perm = supported ? Notification.permission : 'unsupported';
    const status = !n.enabled ? '' : perm === 'granted' ? 'This browser will show reminders as notifications.'
      : perm === 'denied' ? 'Notifications are blocked in this browser, so reminders show inside Petal instead. You can allow them in your browser settings.'
        : perm === 'unsupported' ? 'This browser does not support notifications, so reminders show inside Petal.' : 'Petal will ask this browser for permission to show notifications.';
    return '<div class="ph">' + subPage('Notifications', '#/settings', 'Gentle reminders. No streaks and no guilt.') +
      '<div class="sec" style="gap: 12px; margin-top: 24px">' +
      switchCard('n-all', 'bell', 'Reminders', n.enabled ? 'On' : 'Off', n.enabled, 'data-act="notify-all"') +
      (status ? '<p class="t-cap">' + status + '</p>' : '') +
      (n.enabled ? switchCard('n-mood', 'face', 'Daily mood check in', 'Once a day if you have not logged a mood yet.', n.moodReminder.on, 'data-act="notify" data-field="moodReminder"') +
        (n.moodReminder.on ? '<div class="field"><label for="mood-time">Time</label><input id="mood-time" class="inp" type="time" data-bind="moodTime" value="' + n.moodReminder.time + '"></div>' : '') +
        switchCard('n-period', 'drop', 'Period coming', n.periodAlert.daysBefore + ' days before your likely start. Always an estimate.', n.periodAlert.on, 'data-act="notify" data-field="periodAlert"') +
        switchCard('n-task', 'cal', 'Task reminders', n.taskReminders.minutesBefore + ' minutes before a planned task.', n.taskReminders.on, 'data-act="notify" data-field="taskReminders"') : '') +
      '<p class="t-cap">Reminders show while Petal is open in a browser tab. Reminders when Petal is closed need web push, which arrives with the server.</p></div></div>';
  }

  function privacyScreen() {
    const a = store.getState().settings.assistantCanUse;
    const rows = [['mood', 'face', 'Mood logs', 'Moods and private notes'], ['pain', 'drop', 'Pain and symptoms', 'Pain level, flow and symptoms'], ['diet', 'leaf', 'Diet and allergies', 'Diet style, allergies and meals'], ['schedule', 'cal', 'Schedule and tasks', 'Your planner and work events']];
    return '<div class="ph">' + subPage('Privacy settings', '#/settings', 'Choose what your assistant can use. You can change this any time.') +
      '<div class="sec" style="gap: 12px; margin-top: 24px">' + rows.map(([k, icon, title, sub]) => switchCard('c-' + k, icon, title, sub, a[k], 'data-act="consent" data-field="' + k + '"')).join('') +
      '<p class="t-cap">Every assistant answer shows which of these it used. Cycle day and phase are always shared, because the assistant cannot plan without them. Your name is never shared.</p>' +
      '<p class="t-cap">The assistant runs on a model on this device, so none of this leaves your computer.</p>' +
      '<p class="t-cap">Your cycle data is never used to show ads. Export or delete everything from Settings, one tap each.</p></div></div>';
  }

  function welcomeBack() {
    const name = store.getState().profile.displayName;
    return '<div class="ph" style="justify-content: center; gap: 16px; text-align: center; align-items: center">' + LOGO.replace('width="24" height="24"', 'width="72" height="72"') +
      '<h1 class="t-title" style="margin: 0">Welcome back' + (name ? ', ' + esc(name) : '') + '</h1>' +
      '<p class="t-sub" style="margin: 0">You are logged out. Your data is still saved on this device.</p>' +
      '<button class="pt-btn pt-btn-primary block" data-act="login" style="margin-top: 16px">Continue</button>' +
      '<p class="t-cap">Sign in with email, Google or Apple arrives with accounts in milestone 1.</p></div>';
  }

  // Shows due reminders as browser notifications, or as an in-app toast when that is not allowed.
  const FIRED_KEY = 'petal.reminders.fired';
  function readFired() { try { return JSON.parse(localStorage.getItem(FIRED_KEY)) || {}; } catch (e) { return {}; } }
  function checkReminders() {
    const state = store.getState();
    if (state.settings.onboardingStep !== 'done' || state.settings.signedOut) return;
    const fired = readFired();
    P.dueReminders(state, now(), fired).forEach((r) => {
      let title, body;
      if (r.key === 'mood') { title = 'How do you feel today?'; body = 'Log your mood in a few taps.'; fired.mood = r.id; }
      else if (r.key === 'period') { title = 'Your period may start soon'; body = 'Likely ' + fmtBetween(r.earliest, r.latest) + '. This is an estimate.'; fired.period = r.id; }
      else { title = r.title; body = 'Due in ' + r.minutes + ' minutes.'; fired.tasks = (fired.tasks || []).concat(r.id).slice(-50); }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(title, { body, tag: 'petal-' + r.key }); } catch (e) { toast(title); }
      } else {
        toast(title);
      }
    });
    try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired)); } catch (e) { /* per device convenience only */ }
  }

  /* ------------------------------------------------------------------ */
  /* Assistant (F13): a local model through PetalAssistant               */
  /* ------------------------------------------------------------------ */

  const A = window.PetalAssistant;
  const chat = {
    conn: 'unknown',  // 'unknown' | 'checking' | 'offline' | 'ready'
    models: [],
    thread: [],       // what the screen shows: { role: 'user' | 'ai', text, basis, tools, error }
    api: [],          // what the model sees (without the system prompt), memory only
    notes: [],        // confirmations to tell the model with the next message
    busy: false,
    abort: null,
  };
  const SUGGESTIONS = ['Plan my week', 'Dinner ideas', 'Why am I tired?'];
  const PREFERRED_MODELS = /llama3\.[12]|qwen(2\.5|3)|mistral|gemma3/;

  async function checkConnection() {
    chat.conn = 'checking';
    render();
    const cfg = store.getState().settings.assistant;
    const res = await A.status(cfg.baseUrl);
    chat.models = res.models;
    chat.conn = res.ok ? 'ready' : 'offline';
    if (res.ok && !res.models.includes(cfg.model)) {
      const pick = res.models.find((m) => PREFERRED_MODELS.test(m)) || res.models[0] || '';
      if (pick) { store.actions.updateAssistant({ model: pick }); return; }
    }
    render();
  }

  // Ollama accepts pages served from this computer by default. A hosted copy (such as a test link) must be allowed by name.
  function hostedOrigin() {
    return location.protocol === 'https:' && !['127.0.0.1', 'localhost'].includes(location.hostname) ? location.origin : '';
  }

  function contextChips(state, ctx) {
    const allow = state.settings.assistantCanUse;
    const chips = [];
    if (ctx.phase) chips.push(P.PHASES[ctx.phase].label + ', day ' + ctx.cycleDay);
    if (allow.pain) chips.push('Pain ' + state.cycle.typicalPain + ' of 10');
    if (allow.diet) {
      const h = state.health;
      const d = h.allergies.map((a) => LABELS.allergies[a] || a).concat(h.dietStyles.filter((x) => x !== 'none').map((x) => LABELS.dietStyles[x]))[0];
      if (d) chips.push(d);
    }
    if (allow.schedule && state.profile.occupation) chips.push(LABELS.occupation[state.profile.occupation]);
    return chips;
  }

  // Model text is untrusted: escape first, then allow **bold** and "If ... then ..." lines only.
  function renderModelText(text) {
    const lines = String(text).split(/\n+/).map((l) => l.trim().replace(/^[-*•]\s+/, '')).filter(Boolean);
    const alts = [];
    const out = [];
    lines.forEach((l) => {
      const html = esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (/^if\b/i.test(l) && /\bthen\b/i.test(l)) alts.push('<span>' + html.replace(/^if\b/i, '<b>If</b>').replace(/\bthen\b/i, '<b>then</b>') + '</span>');
      else out.push('<span>' + html + '</span>');
    });
    return out.join('') + (alts.length ? '<div class="pt-alt">' + alts.join('') + '</div>' : '');
  }

  function toolCard(call, mi, ci) {
    const a = call.args;
    let title, detail;
    if (call.name === 'add_task') {
      title = 'Add task: ' + a.title;
      detail = fmtLong(a.date) + ' at ' + a.time + ', ' + LABELS.taskType[a.type].toLowerCase() + ', ' + LABELS.effort[a.effort].toLowerCase() + ' effort';
    } else {
      title = 'Log mood: ' + a.moods.map((m) => P.MOODS[m].label.toLowerCase()).join(', ');
      detail = a.note ? 'Note: ' + a.note : 'For today';
    }
    const foot = call.state === 'pending'
      ? '<div style="display: flex; gap: 8px; margin-top: 8px"><button class="pt-btn pt-btn-secondary" data-act="tool-accept" data-m="' + mi + '" data-c="' + ci + '">' + (call.name === 'add_task' ? 'Add it' : 'Log it') + '</button><button class="pt-btn pt-btn-text" data-act="tool-decline" data-m="' + mi + '" data-c="' + ci + '">Not now</button></div>'
      : '<span class="t-cap" style="margin-top: 4px">' + (call.state === 'done' ? 'Saved.' : 'Not saved.') + '</span>';
    return '<div class="pt-card" style="padding: 12px 16px; border-radius: 16px; display: flex; flex-direction: column; gap: 2px"><b style="font: 700 15px/20px var(--font-sans); color: var(--ink); overflow-wrap: anywhere">' + esc(title) + '</b><span class="t-cap" style="overflow-wrap: anywhere">' + esc(detail) + '</span>' + foot + '</div>';
  }

  function chatBubble(m, mi) {
    if (m.role === 'user') return '<div class="pt-msg pt-msg-user" style="overflow-wrap: anywhere">' + esc(m.text) + '</div>';
    if (m.error) return '<div class="pt-msg pt-msg-ai" role="alert" style="display: flex; flex-direction: column; gap: 8px"><span>' + esc(m.error) + '</span></div>';
    const streaming = chat.busy && mi === chat.thread.length - 1;
    const body = streaming ? '<span data-stream style="white-space: pre-wrap">' + esc(m.text || 'Thinking') + '</span>' : renderModelText(m.text);
    return '<div class="pt-msg pt-msg-ai" style="display: flex; flex-direction: column; gap: 10px; max-width: 94%; overflow-wrap: anywhere">' + body +
      (m.tools || []).map((c, ci) => toolCard(c, mi, ci)).join('') +
      (streaming ? '' : '<span class="pt-src">Based on: ' + esc(m.basis.join(', ')) + '.</span><span class="t-cap">This is an estimate, not medical advice. Pain that stops daily life is worth raising with a clinician.</span>') + '</div>';
  }

  function assistantScreen() {
    const state = store.getState();
    const top = '<div class="top" style="justify-content: space-between"><div style="display: flex; align-items: center; gap: 8px">' + LOGO.replace('width="24" height="24"', 'width="32" height="32"') + '<h1 class="t-title" style="margin: 0">Assistant</h1></div>' +
      (store.select.can('assistant') ? '<button class="ico" data-act="open" data-type="chat-options" aria-label="Chat options" style="width: 44px; height: 44px">' + svg('dots') + '</button>' : '') + '</div>';
    if (!store.select.can('assistant')) {
      return '<div class="ph has-tabs">' + top + '<div class="pt-card" style="margin-top: 24px; padding: 20px; border-radius: 24px; display: flex; flex-direction: column; gap: 8px"><b class="t-head">The assistant is part of Pro</b>' +
        '<span class="t-sub" style="margin: 0">It reads your phase and the logs you allow, then helps you plan food, training and work.</span>' +
        '<button class="pt-btn pt-btn-primary" data-act="go" data-to="#/settings/subscription" style="margin-top: 8px; align-self: flex-start">Try Pro features</button></div>' + tabs('assistant') + '</div>';
    }
    if (chat.conn === 'unknown') setTimeout(checkConnection, 0);
    const cfg = state.settings.assistant;
    if (chat.conn !== 'ready' || !cfg.model) {
      const checking = chat.conn === 'checking' || chat.conn === 'unknown';
      const noModels = chat.conn === 'ready';
      return '<div class="ph has-tabs">' + top + '<div class="pt-card" style="margin-top: 24px; padding: 20px; border-radius: 24px; display: flex; flex-direction: column; gap: 10px">' +
        '<b class="t-head">' + (checking ? 'Looking for a model on this device' : noModels ? 'No model installed yet' : 'Connect a model on this device') + '</b>' +
        '<span class="t-sub" style="margin: 0">Petal runs the assistant with a free model on your own computer, so your cycle data never leaves it.</span>' +
        (checking ? '' : '<ol class="t-sub" style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px">' +
          (noModels ? '' : '<li>Install Ollama from ollama.com and open it.</li>') +
          '<li>In a terminal, run <code>ollama pull llama3.2</code>.</li>' +
          (hostedOrigin() ? '<li>Let Ollama accept this site: set <code>OLLAMA_ORIGINS</code> to <code>' + esc(hostedOrigin()) + '</code>, then quit and reopen Ollama.</li>' : '') +
          '<li>Come back and tap Try again.</li></ol>' +
          '<span class="t-cap">Looking at ' + esc(cfg.baseUrl) + '. You can change this in chat options.</span>' +
          '<button class="pt-btn pt-btn-primary" data-act="chat-retry" style="align-self: flex-start">Try again</button>') + '</div>' + tabs('assistant') + '</div>';
    }
    const ctx = P.buildAssistantContext(state, P.today(now()));
    const chips = contextChips(state, ctx).map((c) => '<span class="chip chip-line">' + esc(c) + '</span>').join('');
    const intro = chat.thread.length ? '' : '<div class="pt-msg pt-msg-ai" style="display: flex; flex-direction: column; gap: 8px"><span>Ask me about food, training or planning around your cycle. I can also add tasks or log a mood once you confirm.</span>' +
      '<span class="pt-src">Sharing: cycle day and phase' + (Object.keys(state.settings.assistantCanUse).filter((k) => state.settings.assistantCanUse[k]).map((k) => ', ' + { mood: 'moods', pain: 'pain', diet: 'diet', schedule: 'schedule' }[k]).join('')) + '.</span>' +
      '<button class="linkbtn" data-act="go" data-to="#/settings/privacy" style="align-self: flex-start; padding: 0">Choose what I can use</button></div>';
    return '<div class="ph has-tabs chat-page">' + top +
      '<div class="chips" style="margin-top: 16px; gap: 6px">' + chips + '</div>' +
      '<div class="chat" style="margin-top: 16px" aria-live="polite">' + intro + chat.thread.map(chatBubble).join('') + '</div>' +
      '<div class="chat-dock">' + (chat.thread.length ? '' : '<div class="chips" style="gap: 6px">' + SUGGESTIONS.map((s) => '<button class="opt" data-act="chat-suggest" data-value="' + esc(s) + '" style="height: 40px; font-size: 13px">' + esc(s) + '</button>').join('') + '</div>') +
      '<form class="pt-compose" data-form="chat" style="padding-left: 4px"><label for="chat-q" class="sr-only">Message</label><input id="chat-q" name="q" class="chat-inp" autocomplete="off" maxlength="1000" placeholder="Ask about your cycle"' + (chat.busy ? ' disabled' : '') + '>' +
      (chat.busy ? '<button type="button" class="pt-send" data-act="chat-stop" aria-label="Stop"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>'
        : '<button type="submit" class="pt-send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg></button>') + '</form></div>' +
      tabs('assistant') + '</div>';
  }
  function chatOptionsSheet() {
    const cfg = store.getState().settings.assistant;
    const models = chat.models.length ? chat.models : cfg.model ? [cfg.model] : [];
    return '<div class="scrim" data-act="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="Chat options"><div class="handle"></div>' + sheetHead('Chat options') +
      '<form data-form="assistant" style="display: flex; flex-direction: column; gap: 12px">' +
      '<div class="field"><label for="co-model">Model</label>' + (models.length
        ? '<select id="co-model" name="model" class="inp">' + models.map((m) => '<option value="' + esc(m) + '"' + (m === cfg.model ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>'
        : '<p class="t-cap">No models found yet.</p>') + '</div>' +
      '<div class="field"><label for="co-url">Model server on this device</label><input id="co-url" name="baseUrl" class="inp" value="' + esc(cfg.baseUrl) + '" inputmode="url" autocomplete="off" spellcheck="false">' +
      '<p class="t-cap">Only addresses on this computer work, such as http://127.0.0.1:11434 for Ollama or http://127.0.0.1:1234 for LM Studio.</p></div>' +
      '<p class="t-cap" id="err" role="alert" style="color: var(--period-ink)"></p>' +
      '<button type="submit" class="pt-btn pt-btn-primary block">Save</button>' +
      '<button type="button" class="pt-btn pt-btn-text block" data-act="chat-clear">Clear chat</button>' +
      '<p class="t-cap">Chats stay in this tab only and clear when you reload. Nothing is sent anywhere except the model on this device.</p></form></section>';
  }

  // One user turn: send, run read only tools, stop at the first proposal that needs a person.
  async function runAssistant(text) {
    const state = store.getState();
    const cfg = state.settings.assistant;
    const todayIso = P.today(now());
    const note = chat.notes.length ? '\n\n(Petal: ' + chat.notes.join(' ') + ')' : '';
    chat.notes = [];
    chat.thread.push({ role: 'user', text });
    chat.api.push({ role: 'user', content: text + note });
    const ctx = P.buildAssistantContext(state, todayIso);
    const reply = { role: 'ai', text: '', basis: ctx.basis, tools: [] };
    chat.thread.push(reply);
    chat.busy = true;
    chat.abort = new AbortController();
    render();
    window.scrollTo(0, document.body.scrollHeight);
    try {
      for (let round = 0; round < 3; round++) {
        let history = chat.api.slice(-16);
        while (history.length && history[0].role !== 'user') history = history.slice(1);
        const prefix = reply.text ? reply.text + '\n\n' : '';
        const res = await A.chat({
          baseUrl: cfg.baseUrl, model: cfg.model, tools: P.ASSISTANT_TOOLS, signal: chat.abort.signal,
          messages: [{ role: 'system', content: P.buildSystemPrompt(ctx) }].concat(history),
          onToken: (t) => { reply.text = prefix + t; const el = app.querySelector('[data-stream]'); if (el) el.textContent = reply.text; },
        });
        reply.text = prefix + res.content;
        chat.api.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls.length ? res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) : undefined });
        let again = false;
        res.toolCalls.forEach((c) => {
          const v = P.validateToolCall(c.name, c.arguments, todayIso);
          let result;
          if (!v.ok) result = { error: v.error };
          else if (!v.write) {
            const info = store.select.phaseFor(v.args.date);
            result = info ? { date: v.args.date, phase: info.label, cycleDay: info.cycleDay, estimate: true } : { error: 'No cycle data yet.' };
            again = true;
          } else {
            reply.tools.push({ name: v.name, args: v.args, state: 'pending' });
            result = { status: 'shown to the person for confirmation, not saved yet' };
          }
          chat.api.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
        });
        if (!again) break;
      }
      if (!reply.text.trim() && !reply.tools.length) reply.text = 'I could not find an answer to that. Try asking another way.';
    } catch (e) {
      const stopped = e && e.name === 'AbortError';
      if (stopped && reply.text) reply.text += ' …';
      else reply.error = stopped ? 'Stopped. The model took too long or you stopped it.'
        : e && e.status === 404 ? 'The model ' + cfg.model + ' is not installed. Pick another one in chat options.'
          : 'I could not reach the model on this device. Check that Ollama is open, then try again.';
    } finally {
      chat.busy = false;
      chat.abort = null;
      render();
      window.scrollTo(0, document.body.scrollHeight);
      const q = document.getElementById('chat-q');
      if (q) q.focus({ preventScroll: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mood (F12) and placeholder tabs                                     */
  /* ------------------------------------------------------------------ */

  function moodScreen() {
    const t = P.today(now());
    const d = ui.moodDraft;
    return '<div class="ph"><div class="top" style="justify-content: space-between"><button class="back" data-act="go" data-to="' + ui.moodReturn + '" aria-label="Close">' + svg('close') + '</button><span class="steplab">' + esc(fmtLong(t)) + '</span></div>' +
      '<h1 class="t-title" style="margin-top: 16px">How do you feel today?</h1><p class="t-sub">Pick all that fit. Patterns across your cycles show up in the Cycle tab.</p>' +
      '<div class="moods" style="margin-top: 24px">' + MOOD_ORDER.map((m) => {
        const on = d.moods.includes(m);
        return '<button class="mood' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="mood" data-value="' + m + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + MOOD_FACES[m] + '</svg>' + P.MOODS[m].label + '</button>';
      }).join('') + '<span></span></div>' +
      '<div class="field" style="margin-top: 24px"><label for="note">Private note</label><textarea id="note" class="area" data-bind="moodNote" placeholder="Anything you want to remember about today" maxlength="1000">' + esc(d.note) + '</textarea><p class="t-cap">Only you can read your notes.</p></div>' +
      '<p class="t-cap" id="err" role="alert" style="margin-top: 8px; color: var(--period-ink)"></p>' +
      '<div class="foot"><button class="pt-btn pt-btn-primary block" data-act="save-mood">Save mood</button><button class="pt-btn pt-btn-text block" data-act="go" data-to="' + ui.moodReturn + '">Cancel</button></div></div>';
  }

  const TAB_COPY = {
    pro: ['Pro', 'Plans and billing arrive in milestone 6.'],
  };
  function placeholder(name) {
    const [title, text] = TAB_COPY[name] || ['Not found', 'This page does not exist.'];
    return '<div class="ph has-tabs">' + header() + '<h1 class="t-title">' + title + '</h1><p class="t-sub">' + text + '</p>' +
      '<button class="pt-btn pt-btn-secondary" data-act="go" data-to="#/" style="margin-top: 24px; align-self: flex-start">Back to dashboard</button>' + tabs(name) + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Render loop                                                         */
  /* ------------------------------------------------------------------ */

  function route() {
    const h = location.hash || '#/';
    const done = store.getState().settings.onboardingStep === 'done';
    const m = h.match(/^#\/setup\/([1-7])$/);
    if (m) return { name: 'setup', step: Number(m[1]) };
    if (!done) return { name: 'redirect', to: '#/setup/1' };
    if (store.getState().settings.signedOut) return { name: 'welcome' };
    const settings = { '#/settings': 'settings', '#/settings/mode': 'mode', '#/settings/subscription': 'subscription', '#/settings/notifications': 'notifications', '#/settings/privacy': 'privacy' }[h];
    if (settings) return { name: settings };
    if (h === '#/mood/new') return { name: 'mood' };
    if (h === '#/mood') return { name: 'moodHistory' };
    const workout = { '#/workout': 'workout', '#/workout/weights': 'weights', '#/workout/weights/gym': 'gym', '#/workout/weights/bodyweight': 'bodyweight', '#/workout/pilates-yoga': 'mat', '#/workout/run': 'run' }[h];
    if (workout) return { name: workout };
    if (h === '#/assistant' || h === '#/tab/assistant') return { name: 'assistant' };
    if (h === '#/pro') return { name: 'tab', tab: 'pro' };
    if (h === '#/goals') return { name: 'goals' };
    if (h === '#/goals/new') return { name: 'new-task' };
    if (h === '#/goals/productivity') return { name: 'trends' };
    const tab = h.match(/^#\/tab\/(\w+)$/);
    if (tab) return { name: 'tab', tab: tab[1] };
    return { name: 'home' };
  }

  function render() {
    const r = route();
    if (r.name === 'redirect') { location.replace(r.to); return; }
    document.documentElement.setAttribute('data-theme', store.getState().settings.theme);

    const active = document.activeElement;
    const focusKey = active && active.dataset ? (active.id ? '#' + active.id : active.dataset.act ? focusSelector(active) : null) : null;
    const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;

    const screens = { setup: () => SETUP[r.step](), mood: moodScreen, moodHistory, tab: () => placeholder(r.tab), goals: planner, 'new-task': newTaskScreen, trends: trendsScreen, home: dashboard,
      workout: workoutHome, weights: weightsScreen, gym: () => listScreen('gym'), bodyweight: () => listScreen('bodyweight'), mat: pilatesYogaScreen, run: runScreen,
      assistant: assistantScreen, settings: settingsScreen, mode: modeScreen, subscription: subscriptionScreen, notifications: notificationsScreen, privacy: privacyScreen, welcome: welcomeBack };
    let html = screens[r.name]();
    if (r.name !== 'setup' && r.name !== 'welcome') html += overlay();
    if (ui.toast) html += '<div class="toast app-toast" role="status">' + svg('tick') + esc(ui.toast) + '</div>';
    app.innerHTML = html;

    if (focusKey) {
      const el = app.querySelector(focusKey);
      if (el) { el.focus({ preventScroll: true }); if (caret && el.setSelectionRange) try { el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* number inputs */ } }
    }
    const sheetEl = ui.overlay && ui.overlay.justOpened && app.querySelector('.sheet');
    const firstField = sheetEl && (sheetEl.querySelector('input:not([type=hidden]), select') || sheetEl.querySelector('button'));
    if (firstField) { firstField.focus(); ui.overlay.justOpened = false; }
  }

  function focusSelector(el) {
    const keys = ['act', 'type', 'value', 'field', 'date', 'd', 'meal', 'to', 'id'];
    return '[' + keys.filter((k) => el.dataset[k] != null).map((k) => 'data-' + k + '="' + CSS.escape(el.dataset[k]) + '"').join('][') + ']';
  }

  function toast(msg) {
    ui.toast = msg;
    render();
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { ui.toast = null; render(); }, 2600);
  }

  function go(to) {
    if (!ui.keepOverlay) ui.overlay = null;
    if (location.hash === to) { ui.keepOverlay = false; render(); } else location.hash = to;
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function toggleIn(list, value, exclusive) {
    if (list.includes(value)) return list.filter((v) => v !== value);
    if (value === exclusive) return [value];
    return list.filter((v) => v !== exclusive).concat(value);
  }

  function showError(msg) { const el = document.getElementById('err'); if (el) el.textContent = msg; }

  const ACTIONS = {
    go: (d) => go(d.to),
    close: () => { ui.overlay = null; render(); },
    open: (d) => {
      ui.overlay = { type: d.type, date: d.date || null, meal: d.meal || null, topic: d.topic || null, justOpened: d.type !== 'radial' };
      render();
    },

    // assistant
    'chat-retry': () => checkConnection(),
    'chat-suggest': (d) => { if (!chat.busy) runAssistant(d.value); },
    'chat-stop': () => { if (chat.abort) chat.abort.abort(); },
    'chat-clear': () => { if (chat.abort) chat.abort.abort(); chat.thread = []; chat.api = []; chat.notes = []; ui.overlay = null; render(); },
    'tool-accept': (d) => {
      const call = chat.thread[Number(d.m)] && chat.thread[Number(d.m)].tools[Number(d.c)];
      if (!call || call.state !== 'pending') return;
      const v = P.validateToolCall(call.name, call.args, P.today(now())); // check again at the moment of writing
      if (!v.ok) { call.state = 'declined'; toast('That could not be saved'); return; }
      if (v.name === 'add_task') {
        const [y, m, dd] = v.args.date.split('-').map(Number);
        const [hh, mm] = v.args.time.split(':').map(Number);
        store.actions.addTask({ title: v.args.title, dueAt: new Date(y, m - 1, dd, hh, mm), type: v.args.type, effort: v.args.effort, source: 'assistant' });
        chat.notes.push('They confirmed and saved the task "' + v.args.title + '" on ' + v.args.date + '.');
      } else {
        store.actions.logMood({ moods: v.args.moods, note: v.args.note, source: 'assistant' });
        chat.notes.push('They confirmed and logged moods: ' + v.args.moods.join(', ') + '.');
      }
      call.state = 'done';
      toast(v.name === 'add_task' ? 'Task added for ' + fmtDay(v.args.date) : 'Mood saved for today');
    },
    'tool-decline': (d) => {
      const call = chat.thread[Number(d.m)] && chat.thread[Number(d.m)].tools[Number(d.c)];
      if (!call || call.state !== 'pending') return;
      call.state = 'declined';
      chat.notes.push('They chose not to save the ' + (call.name === 'add_task' ? 'task "' + call.args.title + '"' : 'mood log') + '.');
      render();
    },

    // settings
    'edit-step': (d) => { ui.editReturn = location.hash; go('#/setup/' + d.step); },
    'set-theme': (d) => store.actions.updateSettings({ theme: d.value }),
    logout: () => { ui.overlay = null; ui.session = null; ui.run = null; store.actions.updateSettings({ signedOut: true }); },
    login: () => { store.actions.updateSettings({ signedOut: false }); go('#/'); },
    'notify-all': () => {
      const n = store.getState().settings.notifications;
      if (!n.enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().then(() => render()).catch(() => {});
      }
      store.actions.updateNotifications({ enabled: !n.enabled });
    },
    notify: (d) => {
      const cur = store.getState().settings.notifications[d.field];
      store.actions.updateNotifications({ [d.field]: Object.assign({}, cur, { on: !cur.on }) });
    },
    consent: (d) => store.actions.updateConsent({ [d.field]: !store.getState().settings.assistantCanUse[d.field] }),

    // setup
    'edit-username': () => { ui.usernameEdit = true; ui.usernameTouched = true; render(); const el = document.getElementById('un'); if (el) el.focus(); },
    set: (d) => {
      const value = d.field === 'activityTier' ? Number(d.value) : d.value;
      const fn = { profile: 'updateProfile', cycle: 'updateCycle', health: 'updateHealth' }[d.section];
      store.actions[fn]({ [d.field]: value });
    },
    toggle: (d) => {
      const s = store.getState();
      const list = s[d.section][d.field];
      const fn = { profile: 'updateProfile', health: 'updateHealth' }[d.section];
      store.actions[fn]({ [d.field]: toggleIn(list, d.value, 'none') });
    },
    switch: (d) => {
      const cur = store.getState().profile[d.field];
      store.actions.updateProfile({ [d.field]: !(cur === true) });
    },
    'pick-period': (d) => store.actions.updateCycle({ lastPeriodStart: d.date }),
    'cal-month': (d) => {
      let { y, m } = ui.calMonth;
      m += Number(d.d);
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      ui.calMonth = { y, m };
      render();
    },
    step: (d) => {
      const c = store.getState().cycle;
      store.actions.updateCycle({ [d.field]: c[d.field] + Number(d.d) });
    },
    unit: (d) => {
      if (d.kind === 'Height') ui.heightUnit = d.value; else ui.weightUnit = d.value;
      render();
    },
    'add-allergy': () => {
      const v = ui.allergyQuery.trim();
      if (!v) { const el = document.getElementById('alg'); if (el) el.focus(); return; }
      const h = store.getState().health;
      const preset = Object.keys(LABELS.allergies).find((k) => LABELS.allergies[k].toLowerCase() === v.toLowerCase() || k === v.toLowerCase());
      ui.allergyQuery = '';
      store.actions.updateHealth({ allergies: h.allergies.concat(preset || v) });
    },
    'remove-allergy': (d) => {
      const h = store.getState().health;
      store.actions.updateHealth({ allergies: h.allergies.filter((a) => a !== d.value) });
    },
    continue: (d) => {
      const step = Number(d.step);
      const s = store.getState();
      if (step === 1 && !s.profile.displayName) { const el = document.getElementById('dn'); el.setAttribute('aria-invalid', 'true'); el.focus(); el.placeholder = 'Add a name to continue'; return; }
      if (step === 2 && !s.cycle.lastPeriodStart) { showError('Tap the first day of your last period to continue.'); return; }
      if (ui.editReturn) {
        const back = ui.editReturn;
        ui.editReturn = null;
        go(back);
        toast('Saved');
        return;
      }
      if (step < 7) {
        if (s.settings.onboardingStep !== 'done') store.actions.updateSettings({ onboardingStep: 'step' + (step + 1) });
        go('#/setup/' + (step + 1));
      } else {
        store.actions.updateSettings({ onboardingStep: 'done' });
        go('#/');
      }
    },

    // planner
    'new-task': (d) => {
      ui.newTask = { title: '', date: d.date || (location.hash === '#/goals' && ui.goalsDate) || P.today(now()), time: '09:00', type: 'work', effort: 'medium', note: '' };
      go('#/goals/new');
    },
    'nt-set': (d) => { ui.newTask[d.field] = d.value; render(); },
    'save-task': () => {
      const n = ui.newTask;
      if (!n.title.trim()) { showError('Give the task a name to add it.'); document.getElementById('tt').focus(); return; }
      if (!P.isISODate(n.date) || !/^\d{2}:\d{2}$/.test(n.time)) { showError('Pick a day and a time.'); return; }
      const [y, m, dd] = n.date.split('-').map(Number);
      const [hh, mm] = n.time.split(':').map(Number);
      const task = store.actions.addTask({ title: n.title, dueAt: new Date(y, m - 1, dd, hh, mm), type: n.type, effort: n.effort, note: n.note });
      store.actions.markOverdueTasks(); // a task added with a past time counts as missed
      ui.newTask = null;
      ui.goalsDate = n.date;
      const advice = store.select.can('taskCheck') ? store.select.taskAdvice(task) : null;
      if (advice && (advice.kind === 'caution' || advice.kind === 'peak')) {
        ui.goalsView = 'week';
        ui.overlay = { type: 'advice', taskId: task.id, justOpened: true };
        ui.keepOverlay = true;
      } else {
        toast('Task added');
      }
      go('#/goals');
    },
    'advice-move': (d) => {
      ui.overlay = null;
      ui.goalsDate = d.date;
      store.actions.moveTask(d.id, d.date);
      toast('Moved to ' + fmtDay(d.date));
    },
    'goals-view': (d) => { ui.goalsView = d.value; render(); },
    'goals-step': (d) => {
      const n = Number(d.d);
      if (ui.goalsView === 'month') {
        let { y, m } = parts(ui.goalsDate);
        m += n;
        if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
        ui.goalsDate = y + '-' + String(m).padStart(2, '0') + '-01';
      } else {
        ui.goalsDate = P.addDays(ui.goalsDate, n);
      }
      render();
    },
    'goals-day': (d) => { ui.goalsDate = d.date; ui.goalsView = 'day'; render(); window.scrollTo(0, 0); },
    'trends-view': (d) => { ui.trendsView = d.value; render(); },
    'toggle-pro': () => {
      const s = store.getState().settings;
      store.actions.updateSettings({ plan: s.plan === 'pro' ? 'free' : 'pro' });
    },

    // workouts
    'session-start': (d) => { ui.session = { screen: location.hash, kind: d.kind, startedAt: Date.now(), done: [] }; render(); },
    'session-ex': (d) => { ui.session.done = toggleIn(ui.session.done, d.value); render(); },
    'session-cancel': () => { ui.session = null; render(); },
    'session-finish': () => {
      const s = ui.session;
      const slugs = s.done;
      const ex = CATALOG.EXERCISES.filter((e) => slugs.includes(e.slug));
      const type = s.kind === 'weights' ? 'weights' : ex.length && ex.every((e) => e.location === 'yoga') ? 'yoga' : 'pilates';
      ui.overlay = { type: 'workout', workoutType: type, duration: Math.max(1, Math.round((Date.now() - s.startedAt) / 60000)), sets: slugs.map((slug) => ({ exercise: slug })), fromSession: true, justOpened: true };
      render();
    },
    'run-toggle': () => {
      const r = ui.run;
      if (!r) ui.run = { startedAt: Date.now(), accMs: 0, running: true };
      else if (r.running) { r.accMs += Date.now() - r.startedAt; r.running = false; }
      else { r.startedAt = Date.now(); r.running = true; }
      render();
    },
    'run-finish': () => {
      const r = ui.run;
      if (r.running) { r.accMs += Date.now() - r.startedAt; r.running = false; }
      ui.overlay = { type: 'workout', workoutType: 'running', duration: Math.max(1, Math.round(r.accMs / 60000)), fromSession: true, justOpened: true };
      render();
    },

    // dashboard
    week: (d) => { ui.weekStart = P.addDays(ui.weekStart, Number(d.d)); render(); },
    task: (d) => {
      const task = store.getState().logs.tasks.find((k) => k.id === d.id);
      if (!task) return;
      if (task.status === 'done') store.actions.reopenTask(d.id); else store.actions.completeTask(d.id);
    },
    mood: (d) => { ui.moodDraft.moods = toggleIn(ui.moodDraft.moods, d.value); render(); },
    'save-mood': () => {
      if (!ui.moodDraft.moods.length) { showError('Pick at least one mood to save.'); return; }
      store.actions.logMood({ moods: ui.moodDraft.moods, note: ui.moodDraft.note });
      ui.moodDraft = { moods: [], note: '' };
      ui.moodView = 'week';
      go('#/mood');
      toast('Mood saved for today');
    },
    'mood-view': (d) => { ui.moodView = d.value; render(); },
    theme: () => {
      const s = store.getState().settings;
      store.actions.updateSettings({ theme: s.theme === 'dark' ? 'light' : 'dark' });
    },
    // One tap: everything as JSON (complete, re-importable) and the logs as CSV (for spreadsheets).
    export: () => {
      const stamp = P.today(now());
      const save = (text, type, name) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      save(store.actions.exportData(), 'application/json', 'petal-export-' + stamp + '.json');
      save(store.actions.exportCSV(), 'text/csv', 'petal-logs-' + stamp + '.csv');
      toast('Export ready: 2 files');
    },
    'delete-all': () => {
      store.actions.deleteAllData();
      try { localStorage.removeItem(FIRED_KEY); } catch (e) { /* ignore */ }
      ui.overlay = null;
      ui.weekStart = null;
      ui.calMonth = null;
      ui.usernameTouched = false;
      go('#/setup/1');
    },
  };

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset); }
  });

  // Typing updates state without a full re-render so the caret stays put.
  app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.mirror) { document.getElementById(el.dataset.mirror).textContent = el.value; return; }
    const bind = el.dataset.bind;
    if (!bind) return;
    const v = el.value;
    const silent = (fn) => { unsub(); try { fn(); } finally { unsub = store.subscribe(render); } };

    if (bind === 'profile.displayName') {
      silent(() => {
        const patch = { displayName: v };
        if (!ui.usernameTouched) patch.username = P.generateUsername(v, now().getFullYear());
        store.actions.updateProfile(patch);
      });
      const p = store.getState().profile;
      const initial = (p.displayName || '?').charAt(0).toUpperCase();
      const av = document.getElementById('avatar');
      av.textContent = initial;
      av.setAttribute('aria-label', 'Avatar preview with the letter ' + initial);
      const un = document.getElementById('un');
      if (un && un.tagName === 'SPAN') un.textContent = '@' + (p.username || 'your_name');
      el.removeAttribute('aria-invalid');
    } else if (bind === 'profile.username') {
      silent(() => store.actions.updateProfile({ username: v }));
    } else if (bind === 'cycle.typicalPain') {
      silent(() => store.actions.updateCycle({ typicalPain: Number(v) }));
      document.getElementById('painv').textContent = v;
      document.getElementById('painw').textContent = 'out of 10, ' + painWord(Number(v));
    } else if (bind === 'height') {
      let cm = null;
      if (v.trim()) {
        if (ui.heightUnit === 'cm') cm = Number(v.replace(',', '.'));
        else {
          const ftIn = v.match(/^\s*(\d+)\s*(?:'|ft|\s)\s*(\d+(?:\.\d+)?)?/);
          cm = ftIn ? (Number(ftIn[1]) * 12 + Number(ftIn[2] || 0)) * 2.54 : Number(v.replace(',', '.')) * 30.48;
        }
        if (!Number.isFinite(cm) || cm < 100) cm = undefined; // wait for a full value
      }
      if (cm !== undefined) silent(() => store.actions.updateProfile({ heightCm: cm }));
    } else if (bind === 'weight') {
      let kg = null;
      if (v.trim()) {
        kg = Number(v.replace(',', '.'));
        if (ui.weightUnit === 'lbs') kg = kg / 2.20462;
        if (!Number.isFinite(kg) || kg < 30) kg = undefined;
      }
      if (kg !== undefined) silent(() => store.actions.updateProfile({ weightKg: kg }));
    } else if (bind === 'profile.age') {
      const n = v.trim() ? Number(v) : null;
      if (n === null || (Number.isFinite(n) && n >= 12 && n <= 70)) silent(() => store.actions.updateProfile({ age: n }));
    } else if (bind === 'allergyQuery') {
      ui.allergyQuery = v;
      render();
    } else if (bind === 'moodNote') {
      ui.moodDraft.note = v;
    } else if (bind === 'moodTime') {
      if (/^\d{2}:\d{2}$/.test(v)) silent(() => store.actions.updateNotifications({ moodReminder: Object.assign({}, store.getState().settings.notifications.moodReminder, { time: v }) }));
    } else if (bind.startsWith('newTask.')) {
      ui.newTask[bind.slice(8)] = v;
    }
  });

  app.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'alg') { e.preventDefault(); ACTIONS['add-allergy'](); }
    if (e.key === 'Escape' && ui.overlay) { ui.overlay = null; render(); }
  });

  app.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const kind = e.target.dataset.form;
    if (kind === 'chat') {
      const q = String(f.q || '').trim().slice(0, 1000);
      if (q && !chat.busy) runAssistant(q);
      return;
    }
    if (kind === 'assistant') {
      if (!P.isLoopbackUrl(String(f.baseUrl || '').trim())) { showError('Use an address on this computer, such as http://127.0.0.1:11434.'); return; }
      const before = store.getState().settings.assistant.baseUrl;
      store.actions.updateAssistant({ baseUrl: String(f.baseUrl).trim(), model: f.model || store.getState().settings.assistant.model });
      ui.overlay = null;
      if (store.getState().settings.assistant.baseUrl !== before) { chat.models = []; checkConnection(); } else render();
      toast('Saved');
      return;
    }
    if (kind === 'meal') {
      store.actions.logMeal({ date: f.date, meal: f.meal, name: f.name, kcal: f.kcal, carbsG: f.carbsG, proteinG: f.proteinG, fatG: f.fatG });
      toast(LABELS.meal[f.meal] + ' added');
    } else if (kind === 'workout') {
      const o = ui.overlay || {};
      store.actions.logWorkout({ date: f.date, type: f.type, durationMin: f.durationMin, effort: f.effort, notes: f.notes, sets: o.sets || [] });
      if (o.fromSession) {
        ui.session = null;
        ui.run = null;
        ui.overlay = null;
        go('#/workout');
      }
      toast('Workout saved');
    }
    ui.overlay = null;
    render();
  });

  let unsub = store.subscribe(render);
  window.addEventListener('hashchange', (e) => {
    const from = new URL(e.oldURL).hash || '#/';
    if (location.hash === '#/mood/new' && from !== '#/mood/new') ui.moodReturn = from === '#/mood' ? '#/mood' : '#/';
    if (location.hash === '#/settings/mode' && from !== '#/settings/mode') ui.settingsBack = from.startsWith('#/setup') ? '#/' : from;
    if (!location.hash.startsWith('#/setup/')) ui.editReturn = null;
    if (!ui.keepOverlay) ui.overlay = null;
    ui.keepOverlay = false;
    render();
  });

  // Pending tasks whose time has passed become missed (minus 1 on the score).
  store.actions.markOverdueTasks();
  setInterval(() => store.actions.markOverdueTasks(), 60000);
  setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 2000);

  // Console access only when asked for with ?debug, so other scripts cannot find the store by name.
  if (new URLSearchParams(location.search).has('debug')) window.petalStore = store;
  render();
})();
