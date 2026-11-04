/*
 * Neck PT engine.
 *
 * Pure logic, no DOM. A session is compiled into a flat list of timed steps
 * (intro → get ready → hold → rest → hold …). The UI walks that list with a
 * wall-clock timer, which keeps pause/resume, "back one rep" and
 * resume-after-reload simple and accurate.
 *
 * Sessions store a snapshot of the exercises as they were when the session
 * started, so editing the routine only changes future sessions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeckEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- dates (local calendar days as YYYY-MM-DD) ----------

  const pad = (n) => String(n).padStart(2, '0');

  function toKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }

  function addDays(key, n) {
    const d = fromKey(key);
    d.setDate(d.getDate() + n);
    return toKey(d);
  }

  function diffDays(a, b) {
    const da = fromKey(a);
    const db = fromKey(b);
    return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
  }

  /** Monday = 0 … Sunday = 6 */
  function weekday(key) {
    return (fromKey(key).getDay() + 6) % 7;
  }

  function weekStart(key) {
    return addDays(key, -weekday(key));
  }

  function weekOf(key) {
    const m = weekStart(key);
    return Array.from({ length: 7 }, (_, i) => addDays(m, i));
  }

  // ---------- seed data ----------

  const SEED = [
    { id: 'chin-tucks', name: 'Chin tucks', type: 'hold-reps', reps: 10, holdSeconds: 5, restSeconds: 3, sideRestSeconds: 10, sides: 'none',
      cue: 'Glide head straight back, make a double chin. Don’t tip up or down.' },
    { id: 'scap-squeezes', name: 'Scapular squeezes', type: 'hold-reps', reps: 10, holdSeconds: 5, restSeconds: 3, sideRestSeconds: 10, sides: 'none',
      cue: 'Shoulder blades back and down, into your back pockets.' },
    { id: 'neck-rotations', name: 'Neck rotations', type: 'reps', reps: 10, holdSeconds: 2, restSeconds: 3, sideRestSeconds: 10, sides: 'alternating',
      cue: 'Turn slowly to look over your shoulder. Mild stretch only.' },
    { id: 'side-bends', name: 'Side bends', type: 'hold-sets', reps: 3, holdSeconds: 20, restSeconds: 10, sideRestSeconds: 10, sides: 'each',
      cue: 'Ear toward shoulder; keep shoulder down.' },
    { id: 'upper-trap', name: 'Upper trap stretch', type: 'hold-sets', reps: 3, holdSeconds: 30, restSeconds: 10, sideRestSeconds: 10, sides: 'each',
      cue: 'Sit on one hand, tilt head away, gently assist with other hand.' },
    { id: 'doorway-pec', name: 'Doorway pec stretch', type: 'hold-sets', reps: 3, holdSeconds: 30, restSeconds: 10, sideRestSeconds: 10, sides: 'none',
      cue: 'Forearms on frame at shoulder height, step through.' },
    { id: 'wall-angels', name: 'Wall angels', type: 'reps', reps: 10, holdSeconds: 0, restSeconds: 3, sideRestSeconds: 10, sides: 'none',
      cue: 'Back against wall, goalpost arms, slide up and down keeping contact.' },
  ].map((e, i) => ({ ...e, enabled: true, order: i }));

  function defaultSettings(today) {
    return {
      disclaimerAccepted: false,
      voice: true,
      tones: true,
      paceMode: 'auto', // 'auto' | 'tap'
      paceSeconds: 4,
      reminderTimes: ['08:00'],
      programStart: today,
      programWeeks: 8,
    };
  }

  function freshState(today) {
    return { exercises: SEED.map((e) => ({ ...e })), settings: defaultSettings(today), sessions: [], active: null };
  }

  // ---------- validation ----------

  const TYPES = ['hold-reps', 'hold-sets', 'reps'];
  const SIDES = ['none', 'alternating', 'each'];
  const int = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
  const str = (v, d = '') => (typeof v === 'string' ? v : d);
  const isKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  function cleanExercise(e, i) {
    if (!e || typeof e !== 'object' || !str(e.name).trim()) return null;
    return {
      id: str(e.id) || `ex-${i}-${Math.random().toString(36).slice(2, 8)}`,
      name: str(e.name).trim(),
      type: TYPES.includes(e.type) ? e.type : 'hold-reps',
      reps: int(e.reps, 1, 100, 10),
      holdSeconds: int(e.holdSeconds, 0, 600, 5),
      restSeconds: int(e.restSeconds, 0, 600, 3),
      sideRestSeconds: int(e.sideRestSeconds, 0, 600, 10),
      sides: SIDES.includes(e.sides) ? e.sides : 'none',
      cue: str(e.cue),
      enabled: e.enabled !== false,
      order: int(e.order, 0, 10000, i),
    };
  }

  /** Validate loaded/imported data. Returns { state, dropped } where dropped counts unreadable records. */
  function normalize(raw, today) {
    const base = freshState(today);
    if (!raw || typeof raw !== 'object') return { state: base, dropped: 1 };
    let dropped = 0;
    const exercises = Array.isArray(raw.exercises)
      ? raw.exercises.map((e, i) => cleanExercise(e, i) || (dropped++, null)).filter(Boolean)
      : base.exercises;
    exercises.sort((a, b) => a.order - b.order).forEach((e, i) => (e.order = i));
    const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const times = Array.isArray(s.reminderTimes) ? s.reminderTimes.filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 2) : [];
    const settings = {
      disclaimerAccepted: !!s.disclaimerAccepted,
      voice: s.voice !== false,
      tones: s.tones !== false,
      paceMode: s.paceMode === 'tap' ? 'tap' : 'auto',
      paceSeconds: int(s.paceSeconds, 2, 15, 4),
      reminderTimes: times.length ? times : ['08:00'],
      programStart: isKey(s.programStart) ? s.programStart : today,
      programWeeks: int(s.programWeeks, 1, 52, 8),
    };
    const sessions = [];
    for (const x of Array.isArray(raw.sessions) ? raw.sessions : []) {
      if (!x || !isKey(x.date) || !Array.isArray(x.snapshot) || !Array.isArray(x.results)) { dropped++; continue; }
      sessions.push({
        id: str(x.id) || `s-${Math.random().toString(36).slice(2, 10)}`,
        date: x.date,
        startedAt: Number(x.startedAt) || 0,
        endedAt: Number(x.endedAt) || 0,
        durationSec: int(x.durationSec, 0, 86400, 0),
        status: x.status === 'completed' ? 'completed' : 'ended',
        completionPct: Math.min(100, Math.max(0, Number(x.completionPct) || 0)),
        painBefore: x.painBefore == null ? null : int(x.painBefore, 0, 10, null),
        painAfter: x.painAfter == null ? null : int(x.painAfter, 0, 10, null),
        tingling: Array.isArray(x.tingling) ? x.tingling.filter((t) => typeof t === 'string') : [],
        note: str(x.note),
        checkedIn: !!x.checkedIn,
        snapshot: x.snapshot.map(cleanExercise).filter(Boolean),
        results: x.results.filter((r) => r && typeof r.name === 'string'),
      });
    }
    let active = null;
    if (raw.active && Array.isArray(raw.active.snapshot) && isKey(raw.active.date)) {
      const a = raw.active;
      active = {
        id: str(a.id) || `s-${Date.now().toString(36)}`,
        date: a.date,
        startedAt: Number(a.startedAt) || Date.now(),
        snapshot: a.snapshot.map(cleanExercise).filter(Boolean),
        plan: { paceMode: a.plan && a.plan.paceMode === 'tap' ? 'tap' : 'auto', paceSeconds: int(a.plan && a.plan.paceSeconds, 2, 15, 4) },
        stepIndex: int(a.stepIndex, 0, 100000, 0),
        done: Array.isArray(a.done) ? a.done.filter(Number.isInteger) : [],
        skipped: Array.isArray(a.skipped) ? a.skipped.filter(Number.isInteger) : [],
        activeMs: Math.max(0, Number(a.activeMs) || 0),
      };
    }
    return { state: { exercises, settings, sessions, active }, dropped };
  }

  // ---------- plan ----------

  const INTRO_SECONDS = 8;
  const READY_SECONDS = 3;

  function unit(ex) {
    return ex.type === 'hold-sets' ? 'Set' : 'Rep';
  }

  function describe(ex) {
    const n = ex.reps;
    const u = ex.type === 'hold-sets' ? (n === 1 ? 'set' : 'sets') : n === 1 ? 'rep' : 'reps';
    const sides = ex.sides === 'each' ? ' per side' : ex.sides === 'alternating' ? ' per side, alternating' : '';
    const hold = ex.holdSeconds > 0 ? ` · ${ex.holdSeconds}s hold` : '';
    return `${n} ${u}${sides}${hold}`;
  }

  function blocksFor(ex) {
    const range = Array.from({ length: Math.max(1, ex.reps) }, (_, i) => i + 1);
    if (ex.sides === 'each') {
      return [range.map((rep) => ({ rep, side: 'left' })), range.map((rep) => ({ rep, side: 'right' }))];
    }
    if (ex.sides === 'alternating') {
      return [range.flatMap((rep) => [{ rep, side: 'left' }, { rep, side: 'right' }])];
    }
    return [range.map((rep) => ({ rep, side: null }))];
  }

  /**
   * Step: { kind: 'intro'|'ready'|'hold'|'rest'|'move', ex, duration (s, or null = wait for tap),
   *         rep, of, side, isRep, label }
   */
  function buildPlan(exercises, opts) {
    const steps = [];
    exercises.forEach((e, ex) => {
      const of = Math.max(1, e.reps);
      steps.push({ kind: 'intro', ex, duration: INTRO_SECONDS, rep: 0, of, side: null, isRep: false, label: ex === 0 ? 'First up' : 'Next up' });
      blocksFor(e).forEach((block, b) => {
        const first = block[0];
        if (b > 0) steps.push({ kind: 'rest', ex, duration: Math.max(1, e.sideRestSeconds), rep: first.rep, of, side: first.side, isRep: false, label: 'Switch sides' });
        steps.push({ kind: 'ready', ex, duration: READY_SECONDS, rep: first.rep, of, side: first.side, isRep: false, label: 'Get ready' });
        block.forEach(({ rep, side }, i) => {
          if (e.holdSeconds > 0) {
            steps.push({ kind: 'hold', ex, duration: e.holdSeconds, rep, of, side, isRep: true, label: 'Hold' });
            const next = block[i + 1];
            if (next && e.restSeconds > 0) steps.push({ kind: 'rest', ex, duration: e.restSeconds, rep: next.rep, of, side: next.side, isRep: false, label: 'Relax' });
          } else {
            const auto = opts.paceMode !== 'tap';
            steps.push({ kind: 'move', ex, duration: auto ? Math.max(1, opts.paceSeconds) : null, rep, of, side, isRep: true, label: auto ? 'Move' : 'Tap each rep' });
          }
        });
      });
    });
    return steps;
  }

  function repTargets(steps, n) {
    const t = new Array(n).fill(0);
    for (const s of steps) if (s.isRep) t[s.ex]++;
    return t;
  }

  function repsDone(steps, done, n) {
    const d = new Array(n).fill(0);
    for (const i of done) if (steps[i] && steps[i].isRep) d[steps[i].ex]++;
    return d;
  }

  function nextExerciseStart(steps, ex) {
    const i = steps.findIndex((s) => s.ex > ex);
    return i === -1 ? steps.length : i;
  }

  /** "Back one rep": restart the current rep if well into it, else the previous rep, else this exercise's get-ready. */
  function backTarget(steps, index, elapsedMs) {
    const cur = steps[index];
    if (!cur) return index;
    if (cur.isRep && elapsedMs > 1500) return index;
    for (let j = index - 1; j >= 0 && steps[j].ex === cur.ex; j--) if (steps[j].isRep) return j;
    const ready = steps.findIndex((s) => s.ex === cur.ex && s.kind === 'ready');
    return ready === -1 ? index : ready;
  }

  function estimateSeconds(steps, tapSeconds = 4) {
    return steps.reduce((sum, s) => sum + (s.duration == null ? tapSeconds : s.duration), 0);
  }

  /** Per-exercise results and completion % for a finished (or ended) session. */
  function summarize(snapshot, steps, done, skipped, status, index) {
    const targets = repTargets(steps, snapshot.length);
    const got = repsDone(steps, done, snapshot.length);
    const skip = new Set(skipped);
    const reached = status === 'completed' ? snapshot.length - 1 : steps[index] ? steps[index].ex : snapshot.length - 1;
    const results = snapshot.map((e, i) => ({
      id: e.id,
      name: e.name,
      repsDone: got[i],
      repsTarget: targets[i],
      status: skip.has(i) ? 'skipped' : got[i] >= targets[i] ? 'done' : i <= reached ? 'partial' : 'not reached',
    }));
    const total = targets.reduce((a, b) => a + b, 0);
    const sum = got.reduce((a, b) => a + b, 0);
    return { results, completionPct: total ? Math.round((sum / total) * 100) : 0 };
  }

  // ---------- progress ----------

  function doneDays(sessions) {
    return new Set(sessions.filter((s) => s.status === 'completed').map((s) => s.date));
  }

  /** Consecutive completed days ending today, or yesterday if today isn't done yet. */
  function streak(days, today) {
    let k = days.has(today) ? today : addDays(today, -1);
    let n = 0;
    while (days.has(k)) { n++; k = addDays(k, -1); }
    return n;
  }

  function programWeek(start, today, weeks) {
    const d = diffDays(start, today);
    if (d < 0) return 0;
    return Math.min(weeks, Math.floor(d / 7) + 1);
  }

  /** Pain points for the chart: one per session with a check-in, within the last `days` days. */
  function painSeries(sessions, today, days) {
    const from = addDays(today, -(days - 1));
    return sessions
      .filter((s) => s.date >= from && s.date <= today && (s.painBefore != null || s.painAfter != null))
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((s) => ({ date: s.date, x: diffDays(from, s.date), before: s.painBefore, after: s.painAfter }));
  }

  function skipCounts(sessions) {
    const m = new Map();
    for (const s of sessions) {
      for (const r of s.results) {
        const c = m.get(r.name) || { name: r.name, skipped: 0, total: 0 };
        c.total++;
        if (r.status === 'skipped') c.skipped++;
        m.set(r.name, c);
      }
    }
    return [...m.values()].sort((a, b) => b.skipped - a.skipped || a.name.localeCompare(b.name));
  }

  // ---------- export ----------

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(sessions) {
    const head = ['date', 'start_time', 'duration_min', 'status', 'completion_pct', 'pain_before', 'pain_after', 'tingling_worse', 'exercises', 'note'];
    const rows = sessions.slice().sort((a, b) => a.startedAt - b.startedAt).map((s) => {
      const t = new Date(s.startedAt);
      const name = (id) => (s.snapshot.find((e) => e.id === id) || { name: id }).name;
      return [
        s.date,
        `${pad(t.getHours())}:${pad(t.getMinutes())}`,
        (s.durationSec / 60).toFixed(1),
        s.status,
        s.completionPct,
        s.painBefore == null ? '' : s.painBefore,
        s.painAfter == null ? '' : s.painAfter,
        s.tingling.map(name).join('; '),
        s.results.map((r) => `${r.name} ${r.repsDone}/${r.repsTarget}${r.status === 'done' ? '' : ` (${r.status})`}`).join('; '),
        s.note,
      ].map(csvCell).join(',');
    });
    return [head.join(','), ...rows].join('\n') + '\n';
  }

  /**
   * Daily reminders as a calendar file. Home-screen web apps on iPhone can't
   * schedule their own notifications, so Calendar does it instead.
   */
  function toIcs(times, startKey) {
    const ymd = startKey.replace(/-/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Neck PT//Reminders//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Neck PT'];
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const end = h * 60 + m + 15;
      const hhmm = `${pad(h)}${pad(m)}00`;
      const endHhmm = `${pad(Math.floor(end / 60) % 24)}${pad(end % 60)}00`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:neck-pt-${hhmm}@neckpt`,
        `DTSTAMP:${ymd}T000000Z`,
        `DTSTART:${ymd}T${hhmm}`,
        `DTEND:${ymd}T${end >= 1440 ? hhmm : endHhmm}`,
        'RRULE:FREQ=DAILY',
        'SUMMARY:Neck PT',
        'DESCRIPTION:Time for your neck routine. Gentle range only.',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Neck PT',
        'TRIGGER:PT0M',
        'END:VALARM',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  return {
    toKey, fromKey, addDays, diffDays, weekday, weekStart, weekOf,
    SEED, defaultSettings, freshState, normalize, cleanExercise,
    INTRO_SECONDS, READY_SECONDS, unit, describe, buildPlan, repTargets, repsDone, nextExerciseStart, backTarget, estimateSeconds, summarize,
    doneDays, streak, programWeek, painSeries, skipCounts,
    toCsv, toIcs,
  };
});
