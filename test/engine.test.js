const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const AUTO = { paceMode: 'auto', paceSeconds: 4 };
const TAP = { paceMode: 'tap', paceSeconds: 4 };
const byId = (id) => E.SEED.find((e) => e.id === id);

test('date helpers are calendar-based', () => {
  assert.equal(E.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(E.addDays('2026-03-08', 1), '2026-03-09'); // US DST
  assert.equal(E.diffDays('2026-01-01', '2026-12-31'), 364);
  assert.equal(E.weekday('2026-11-02'), 0); // Monday
  assert.equal(E.weekStart('2026-11-08'), '2026-11-02');
});

test('seed routine matches the spec', () => {
  assert.equal(E.SEED.length, 7);
  assert.deepEqual(E.SEED.map((e) => e.name), [
    'Chin tucks', 'Scapular squeezes', 'Neck rotations', 'Side bends', 'Upper trap stretch', 'Doorway pec stretch', 'Wall angels',
  ]);
  assert.equal(byId('upper-trap').holdSeconds, 30);
  assert.equal(byId('neck-rotations').sides, 'alternating');
});

test('hold reps: intro, get ready, then hold/rest pairs with no trailing rest', () => {
  const steps = E.buildPlan([byId('chin-tucks')], AUTO);
  assert.deepEqual(steps.slice(0, 4).map((s) => s.kind), ['intro', 'ready', 'hold', 'rest']);
  assert.equal(steps.filter((s) => s.kind === 'hold').length, 10);
  assert.equal(steps.filter((s) => s.kind === 'rest').length, 9);
  assert.equal(steps[steps.length - 1].kind, 'hold');
  assert.ok(steps.filter((s) => s.kind === 'hold').every((s) => s.duration === 5));
});

test('each-side sets do all left, switch sides, then all right', () => {
  const steps = E.buildPlan([byId('side-bends')], AUTO);
  const holds = steps.filter((s) => s.kind === 'hold');
  assert.deepEqual(holds.map((s) => s.side), ['left', 'left', 'left', 'right', 'right', 'right']);
  const sw = steps.find((s) => s.label === 'Switch sides');
  assert.equal(sw.side, 'right');
  assert.equal(sw.duration, 10);
  assert.equal(E.repTargets(steps, 1)[0], 6);
});

test('alternating reps go left, right, left, right…', () => {
  const holds = E.buildPlan([byId('neck-rotations')], AUTO).filter((s) => s.kind === 'hold');
  assert.equal(holds.length, 20);
  assert.deepEqual(holds.slice(0, 4).map((s) => `${s.rep}${s.side[0]}`), ['1l', '1r', '2l', '2r']);
  assert.ok(holds.every((s) => s.duration === 2));
});

test('moving reps are auto-paced or wait for a tap', () => {
  const auto = E.buildPlan([byId('wall-angels')], AUTO).filter((s) => s.kind === 'move');
  assert.equal(auto.length, 10);
  assert.ok(auto.every((s) => s.duration === 4));
  const tap = E.buildPlan([byId('wall-angels')], TAP).filter((s) => s.kind === 'move');
  assert.ok(tap.every((s) => s.duration === null));
});

test('back one rep: restart current if into it, else previous rep, else get ready', () => {
  const steps = E.buildPlan([byId('chin-tucks')], AUTO);
  const holds = steps.map((s, i) => (s.kind === 'hold' ? i : -1)).filter((i) => i >= 0);
  assert.equal(E.backTarget(steps, holds[3], 3000), holds[3]);
  assert.equal(E.backTarget(steps, holds[3], 200), holds[2]);
  assert.equal(E.backTarget(steps, holds[3] + 1, 200), holds[3]); // from the rest after rep 4
  assert.equal(E.backTarget(steps, holds[0], 200), 1); // the get-ready step
});

test('skip jumps to the next exercise intro', () => {
  const steps = E.buildPlan(E.SEED, AUTO);
  const i = E.nextExerciseStart(steps, 0);
  assert.equal(steps[i].kind, 'intro');
  assert.equal(steps[i].ex, 1);
  assert.equal(E.nextExerciseStart(steps, 6), steps.length);
});

test('summarize scores reps and marks skipped / not reached', () => {
  const snap = [byId('chin-tucks'), byId('doorway-pec'), byId('wall-angels')];
  const steps = E.buildPlan(snap, AUTO);
  const rep = (ex) => steps.map((s, i) => (s.isRep && s.ex === ex ? i : -1)).filter((i) => i >= 0);
  const done = [...rep(0), ...rep(1).slice(0, 1)];
  const at = rep(1)[1];
  const { results, completionPct } = E.summarize(snap, steps, done, [1], 'ended', at);
  assert.deepEqual(results.map((r) => r.status), ['done', 'skipped', 'not reached']);
  assert.deepEqual(results.map((r) => r.repsDone), [10, 1, 0]);
  assert.equal(completionPct, Math.round((11 / 23) * 100));
});

test('full routine estimate is in the 15-20 minute range', () => {
  const min = E.estimateSeconds(E.buildPlan(E.SEED, AUTO)) / 60;
  assert.ok(min > 12 && min < 22, `got ${min}`);
});

test('streak counts back from today, or from yesterday if today is not done', () => {
  const days = new Set(['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(E.streak(days, '2026-11-03'), 3);
  assert.equal(E.streak(days, '2026-11-04'), 3);
  assert.equal(E.streak(days, '2026-11-05'), 0);
});

test('program week', () => {
  assert.equal(E.programWeek('2026-11-01', '2026-11-01', 8), 1);
  assert.equal(E.programWeek('2026-11-01', '2026-11-08', 8), 2);
  assert.equal(E.programWeek('2026-11-01', '2027-06-01', 8), 8);
  assert.equal(E.programWeek('2026-11-10', '2026-11-01', 8), 0);
});

test('editing an exercise does not change a stored session snapshot', () => {
  const state = E.freshState('2026-11-04');
  const snapshot = state.exercises.map((e) => ({ ...e }));
  state.sessions.push({ id: 's1', date: '2026-11-04', snapshot, results: [] });
  state.exercises[0].reps = 3;
  assert.equal(state.sessions[0].snapshot[0].reps, 10);
});

test('normalize repairs bad data and counts what it drops', () => {
  const { state, dropped } = E.normalize({
    exercises: [{ name: 'X', reps: 'lots', type: 'nope' }, { nope: true }],
    settings: { paceMode: 'tap', reminderTimes: ['25:99x', '07:30'] },
    sessions: [{ date: 'bad' }],
  }, '2026-11-04');
  assert.equal(dropped, 2);
  assert.equal(state.exercises.length, 1);
  assert.equal(state.exercises[0].reps, 10);
  assert.equal(state.exercises[0].type, 'hold-reps');
  assert.equal(state.settings.paceMode, 'tap');
  assert.deepEqual(state.settings.reminderTimes, ['07:30']);
  assert.equal(state.settings.programStart, '2026-11-04');
});

test('CSV escapes commas, quotes and newlines', () => {
  const csv = E.toCsv([{
    id: 's', date: '2026-11-04', startedAt: new Date(2026, 10, 4, 8, 5).getTime(), durationSec: 900, status: 'completed',
    completionPct: 100, painBefore: 3, painAfter: 2, tingling: [], note: 'ok, "better"\nthanks',
    snapshot: [], results: [{ name: 'Chin tucks', repsDone: 10, repsTarget: 10, status: 'done' }],
  }]);
  const [head, row] = csv.split('\n');
  assert.ok(head.startsWith('date,start_time,duration_min'));
  assert.ok(row.startsWith('2026-11-04,08:05,15.0,completed,100,3,2,,Chin tucks 10/10,'));
  assert.ok(csv.includes('"ok, ""better""\nthanks"'));
});

test('calendar file has one daily event with an alert per time', () => {
  const ics = E.toIcs(['08:00', '18:30'], '2026-11-04');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes('DTSTART:20261104T080000'));
  assert.ok(ics.includes('DTEND:20261104T184500'));
  assert.ok(ics.includes('RRULE:FREQ=DAILY'));
  assert.ok(ics.includes('BEGIN:VALARM'));
});

test('pain series and skip counts', () => {
  const s = (date, pb, pa, statuses) => ({ date, startedAt: E.fromKey(date).getTime(), painBefore: pb, painAfter: pa,
    results: statuses.map((st, i) => ({ name: `E${i}`, status: st })) });
  const sessions = [s('2026-10-01', 5, 4, ['done', 'skipped']), s('2026-11-03', 4, 2, ['done', 'skipped']), s('2026-11-04', null, null, ['skipped', 'done'])];
  const pts = E.painSeries(sessions, '2026-11-04', 7);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].x, 5);
  const counts = E.skipCounts(sessions);
  assert.deepEqual(counts[0], { name: 'E1', skipped: 2, total: 3 });
});
