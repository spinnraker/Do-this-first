(function () {
  'use strict';

  const E = window.NeckEngine;
  const STORE = 'neckpt:v1';
  const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>',
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  };
  const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const RING_C = 2 * Math.PI * 46;

  const DISCLAIMER = [
    'Gentle range only. You should feel a mild stretch, never strain.',
    'Stop if pain is sharp, shooting, or builds as you go.',
    'Stop any exercise that makes arm tingling or numbness worse, and tell your PT or doctor.',
    'No neck circles and no forcing your head backward.',
    'This app times and logs the routine your clinician gave you. It isn’t medical advice.',
  ];
  const RED_FLAGS = [
    'Hand clumsiness or dropping things',
    'Trouble with buttons, writing or other fine tasks',
    'Balance problems or a change in how you walk',
    'New weakness in an arm or leg',
    'Numbness or tingling that is spreading or getting worse',
    'Any new bladder or bowel changes',
  ];

  const app = document.getElementById('app');
  const sheetEl = document.getElementById('sheet');
  const runEl = document.getElementById('run');
  const toastEl = document.getElementById('toast');

  let state = load();
  let view = 'today';
  let sheet = null;
  let lastToday = today();
  let chartRange = 30;
  let calMonth = today().slice(0, 7);

  // ---------- storage ----------

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE);
      if (raw) {
        const { state: s, dropped } = E.normalize(JSON.parse(raw), today());
        if (dropped) localStorage.setItem(`${STORE}:unreadable:${Date.now()}`, raw);
        return s;
      }
    } catch (e) {
      try { if (raw) localStorage.setItem(`${STORE}:unreadable:${Date.now()}`, raw); } catch (e2) { /* storage unavailable */ }
    }
    return E.freshState(today());
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  // ---------- helpers ----------

  function today() { return E.toKey(new Date()); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
  function exercises() { return state.exercises.slice().sort((a, b) => a.order - b.order); }
  function enabled() { return exercises().filter((e) => e.enabled); }
  function sessionById(id) { return state.sessions.find((s) => s.id === id); }

  function shortDate(key) {
    return E.fromKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function minutes(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
  }

  function progressBar(pct, label) {
    return `<div class="bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
  }

  // ---------- toasts ----------

  const queue = [];
  let toasting = false;

  function toast(...msgs) {
    queue.length = 0;
    queue.push(...msgs);
    if (!toasting) nextToast();
  }

  function nextToast() {
    const msg = queue.shift();
    if (!msg) { toasting = false; return; }
    toasting = true;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(nextToast, 260);
    }, 1600);
  }

  // ---------- files ----------

  function shareFile(text, name, type, title) {
    // Downloads are unreliable in an iPhone home-screen app; the share sheet
    // lets you save to Files instead.
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && typeof File === 'function') {
      const file = new File([text], name, { type });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title }).catch((e) => {
          if (e && e.name !== 'AbortError') download(text, name, type);
        });
        return;
      }
    }
    download(text, name, type);
  }

  function download(text, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function addToCalendar() {
    const ics = E.toIcs(state.settings.reminderTimes, today());
    // Opening a calendar file (rather than downloading it) lets iOS offer "Add All" to Calendar.
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      file.text().then((text) => {
        const raw = JSON.parse(text);
        if (!raw || !Array.isArray(raw.exercises)) throw new Error('not a backup');
        const { state: next, dropped } = E.normalize(raw, today());
        const note = dropped ? ` ${plural(dropped, 'record')} in it can’t be read and will be skipped.` : '';
        if (!confirm(`Replace all current data with this backup?${note}`)) return;
        next.settings.disclaimerAccepted = true;
        state = next;
        save();
        render();
        toast('Backup restored');
      }).catch(() => toast('That file isn’t a Neck PT backup'));
    };
    input.click();
  }

  // ---------- cues: voice, tones, vibration, screen ----------

  const Cues = {
    ctx: null,
    voice: true,
    tones: true,
    held: [], // iOS drops utterances that get garbage-collected mid-speech

    /** Must run inside a tap: iOS only allows audio and speech after a user gesture. */
    unlock(opts) {
      this.voice = opts.voice;
      this.tones = opts.tones;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !this.ctx) this.ctx = new AC();
        if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
      } catch (e) { /* no audio */ }
      if (this.voice && 'speechSynthesis' in window) {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
      }
    },
    say(text, interrupt) {
      if (!this.voice || !('speechSynthesis' in window)) return;
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      this.held.push(u);
      if (this.held.length > 20) this.held.shift();
      speechSynthesis.speak(u);
    },
    stop() {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    },
    beep(freq, ms, delay = 0) {
      if (!this.tones || !this.ctx) return;
      try {
        const t = this.ctx.currentTime + delay;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
        o.connect(g).connect(this.ctx.destination);
        o.start(t);
        o.stop(t + ms / 1000 + 0.02);
      } catch (e) { /* ignore */ }
    },
    buzz(p) { if (this.tones && navigator.vibrate) navigator.vibrate(p); },
    start() { this.beep(880, 220); this.buzz(60); },
    release() { this.beep(660, 120); this.beep(990, 200, 0.13); this.buzz([30, 60, 30]); },
    tick() { this.beep(700, 70); this.buzz(10); },
    tap() { this.beep(520, 60); this.buzz(8); },
  };

  let wakeLock = null;
  async function lockScreen() {
    try {
      if ('wakeLock' in navigator && !document.hidden && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* not supported: rely on Auto-Lock setting */ }
  }
  function releaseScreen() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // ---------- session runner ----------
  //
  // The engine compiles the session into a flat list of timed steps; this walks it
  // with a wall-clock timer. Progress is saved on every step change, so a reload or
  // a backgrounded app resumes where it left off (paused).

  let R = null;
  const sideWord = (s) => (s === 'left' ? 'Left' : s === 'right' ? 'Right' : '');

  function beginSession() {
    closeStale();
    const s = state.settings;
    Cues.unlock(s);
    let fresh = false;
    if (!state.active) {
      const snapshot = enabled().map((e) => ({ ...e }));
      if (!snapshot.length) { toast('Turn on at least one exercise'); return; }
      state.active = {
        id: uid(), date: today(), startedAt: Date.now(), snapshot,
        plan: { paceMode: s.paceMode, paceSeconds: s.paceSeconds },
        stepIndex: 0, done: [], skipped: [], activeMs: 0,
      };
      save();
      fresh = true;
    }
    const a = state.active;
    const now = Date.now();
    const steps = E.buildPlan(a.snapshot, a.plan);
    R = {
      steps,
      index: Math.min(a.stepIndex, steps.length - 1),
      stepStart: now,
      pausedAt: fresh ? null : now,
      reenter: !fresh,
      spoken: new Set(),
      lastTick: now,
      done: new Set(a.done),
      skipped: new Set(a.skipped),
      activeMs: a.activeMs,
      finished: false,
      timer: null,
    };
    runEl.hidden = false;
    app.inert = true;
    document.body.style.overflow = 'hidden';
    lockScreen();
    R.timer = setInterval(tick, 100);
    if (fresh) enterStep(0, now);
    else renderRun();
  }

  function persist() {
    const a = state.active;
    if (!a || !R) return;
    a.stepIndex = R.index;
    a.done = [...R.done];
    a.skipped = [...R.skipped];
    a.activeMs = Math.round(R.activeMs);
    save();
  }

  function accrue(now) {
    if (R.pausedAt == null && !R.finished) R.activeMs += Math.min(2000, Math.max(0, now - R.lastTick));
    R.lastTick = now;
  }

  function enterStep(i, startAt) {
    if (i >= R.steps.length) { finish('completed'); return; }
    R.index = i;
    R.stepStart = startAt;
    R.spoken.clear();
    R.reenter = false;
    const step = R.steps[i];
    const ex = state.active.snapshot[step.ex];
    switch (step.kind) {
      case 'intro':
        Cues.tap();
        Cues.say(`${step.label}: ${ex.name}. ${ex.cue}`, true);
        break;
      case 'ready':
        Cues.say(step.side ? `${sideWord(step.side)} side. Get ready.` : 'Get ready.');
        break;
      case 'hold':
        Cues.start();
        Cues.say(ex.sides === 'alternating' && step.side ? `${sideWord(step.side)}. Hold.` : 'Hold.');
        break;
      case 'rest':
        if (step.label === 'Switch sides') Cues.say(`Switch sides. ${sideWord(step.side)} side next.`);
        break;
      case 'move':
        if (step.duration != null) {
          Cues.tap();
          Cues.say(step.side ? `${step.rep}, ${sideWord(step.side)}` : String(step.rep));
        }
        break;
    }
    persist();
    renderRun();
  }

  function completeStep(natural) {
    if (!R || R.finished) return;
    const step = R.steps[R.index];
    const now = Date.now();
    if (natural && step.isRep) R.done.add(R.index);
    if (natural && step.kind === 'hold') {
      Cues.release();
      Cues.say('Relax.');
    }
    // Chain from the scheduled end so timing doesn't drift, unless we're well behind.
    let startAt = now;
    if (natural && step.duration != null) {
      const end = R.stepStart + step.duration * 1000;
      if (now - end < 1000) startAt = end;
    }
    enterStep(R.index + 1, startAt);
  }

  function tick() {
    if (!R || R.finished) return;
    const now = Date.now();
    accrue(now);
    if (R.pausedAt != null) return;
    const step = R.steps[R.index];
    if (!step || step.duration == null) return;
    const remaining = step.duration * 1000 - (now - R.stepStart);
    const left = Math.ceil(remaining / 1000);
    const once = (key, fn) => { if (!R.spoken.has(key)) { R.spoken.add(key); fn(); } };
    if (step.kind === 'hold') {
      if (step.duration >= 20 && left === 10) once('10', () => Cues.say('10 seconds.'));
      if (step.duration >= 5 && left >= 1 && left <= 3) once(`c${left}`, () => { Cues.tick(); Cues.say(String(left)); });
    } else if (step.kind === 'rest' && step.duration >= 6 && left === 3) {
      once('gr', () => Cues.say('Get ready.'));
    }
    if (remaining <= 0) completeStep(true);
    else updateClock(remaining, step.duration * 1000);
  }

  function pause() {
    if (!R || R.finished || R.pausedAt != null) return;
    const now = Date.now();
    accrue(now);
    R.pausedAt = now;
    Cues.stop();
    persist();
    renderRun();
  }

  function resume() {
    if (!R || R.finished || R.pausedAt == null) return;
    Cues.unlock(state.settings);
    const now = Date.now();
    const pausedFor = now - R.pausedAt;
    R.pausedAt = null;
    R.lastTick = now;
    lockScreen();
    if (R.reenter) enterStep(R.index, now);
    else { R.stepStart += pausedFor; renderRun(); }
  }

  function unpauseForJump() {
    if (R.pausedAt != null) { R.pausedAt = null; R.lastTick = Date.now(); }
    Cues.unlock(state.settings);
    Cues.stop();
  }

  function skipExercise() {
    if (!R || R.finished) return;
    const ex = R.steps[R.index].ex;
    const got = E.repsDone(R.steps, R.done, state.active.snapshot.length);
    const target = E.repTargets(R.steps, state.active.snapshot.length);
    if (got[ex] < target[ex]) R.skipped.add(ex);
    unpauseForJump();
    enterStep(E.nextExerciseStart(R.steps, ex), Date.now());
  }

  function backRep() {
    if (!R || R.finished) return;
    const elapsed = (R.pausedAt != null ? R.pausedAt : Date.now()) - R.stepStart;
    const target = E.backTarget(R.steps, R.index, R.reenter ? 0 : elapsed);
    for (const i of [...R.done]) if (i >= target) R.done.delete(i);
    R.skipped.delete(R.steps[target].ex);
    unpauseForJump();
    enterStep(target, Date.now());
  }

  function tapRep() {
    const step = R && R.steps[R.index];
    if (!step || R.finished || step.kind !== 'move' || step.duration != null) return;
    unpauseForJump();
    Cues.tap();
    Cues.say(String(step.rep), true);
    completeStep(true);
  }

  function startNow() {
    const step = R && R.steps[R.index];
    if (!step || R.finished || step.isRep) return;
    unpauseForJump();
    completeStep(false);
  }

  function finish(status) {
    if (!R || R.finished) return;
    accrue(Date.now());
    R.finished = true;
    clearInterval(R.timer);
    const a = state.active;
    const sum = E.summarize(a.snapshot, R.steps, [...R.done], [...R.skipped], status, R.index);
    const rec = record(a, status, sum, Math.round(R.activeMs / 1000));
    state.sessions.push(rec);
    state.active = null;
    save();
    if (status === 'completed') {
      Cues.release();
      Cues.say('Routine complete. Nice work.', true);
    } else {
      Cues.stop();
    }
    closeRun();
    render();
    openSheet({ type: 'checkin', id: rec.id, draft: checkinDraft(rec), fresh: true });
  }

  function record(a, status, sum, durationSec) {
    return {
      id: a.id, date: a.date, startedAt: a.startedAt, endedAt: Date.now(), durationSec, status,
      completionPct: sum.completionPct, results: sum.results, snapshot: a.snapshot,
      painBefore: null, painAfter: null, tingling: [], note: '', checkedIn: false,
    };
  }

  function closeRun() {
    if (R) clearInterval(R.timer);
    R = null;
    runEl.hidden = true;
    runEl.innerHTML = '';
    releaseScreen();
    if (!sheet) {
      app.inert = false;
      document.body.style.overflow = '';
    }
  }

  /** A session left open on an earlier day is saved as ended. */
  function closeStale() {
    const a = state.active;
    if (!a || a.date === today() || R) return;
    const steps = E.buildPlan(a.snapshot, a.plan);
    const sum = E.summarize(a.snapshot, steps, a.done, a.skipped, 'ended', a.stepIndex);
    state.sessions.push(record(a, 'ended', sum, Math.round(a.activeMs / 1000)));
    state.active = null;
    save();
  }

  // ---------- session rendering ----------

  function renderRun() {
    if (!R) return;
    const a = state.active;
    const step = R.steps[R.index];
    const ex = a.snapshot[step.ex];
    const n = a.snapshot.length;
    const paused = R.pausedAt != null;
    const overall = Math.round((R.index / R.steps.length) * 100);
    const tapMode = step.kind === 'move' && step.duration == null;
    const phase = step.kind === 'intro' ? step.label : step.kind === 'move' ? 'Rep' : step.label;
    const ringClass = step.kind === 'hold' || step.kind === 'move' ? 'hold' : 'rest';
    const unit = E.unit(ex);

    let stage;
    if (tapMode) {
      stage = `<button class="tap" data-run="tap" aria-label="Count rep ${step.rep} of ${step.of}">
        <b>+1</b><small>${step.rep - 1} of ${step.of} done</small>
      </button>`;
    } else {
      stage = `<div class="ring ${ringClass}" role="timer" aria-live="off">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="46"/>
          <circle class="arc" id="arc" cx="50" cy="50" r="46" stroke-dasharray="${RING_C} ${RING_C}" stroke-dashoffset="0"/></svg>
        <div class="ring-in"><b id="clock">${step.duration}</b><small>${esc(phase)}</small></div>
      </div>`;
    }

    const side = step.side ? `<span class="side ${step.side}">${sideWord(step.side)}</span>` : '';
    const repLine = step.kind === 'intro'
      ? `<div class="s-rep">${esc(E.describe(ex))}</div>`
      : `<div class="s-rep"><span>${unit} ${step.rep} of ${step.of}</span>${side}</div>`;

    const canSkipAhead = !step.isRep;
    const note = paused ? `<div class="paused-note">${R.reenter ? 'Paused · tap play to continue' : 'Paused'}</div>` : '';

    runEl.innerHTML = `<div class="sheet-inner">
      <div class="s-top">
        <button data-run="end">End</button>
        <span class="count">${step.ex + 1} of ${n}</span>
        <button class="flag-btn" data-run="flags">Stop &amp; get seen</button>
      </div>
      <div class="s-bar" aria-hidden="true"><i style="width:${overall}%"></i></div>
      <h1 class="s-name">${esc(ex.name)}</h1>
      <p class="s-cue">${esc(ex.cue)}</p>
      <div class="s-stage">
        ${stage}
        ${repLine}
        ${note}
        ${canSkipAhead && !paused ? `<button class="s-now" data-run="now">${step.kind === 'intro' ? 'Start now' : 'Skip wait'}</button>` : ''}
      </div>
      <div class="controls">
        <button class="ctl" data-run="back" aria-label="Back one rep"><i>${ICON.back}</i>Back rep</button>
        <button class="ctl main" data-run="${paused ? 'resume' : 'pause'}" aria-label="${paused ? 'Resume' : 'Pause'}"><i>${paused ? ICON.play : ICON.pause}</i></button>
        <button class="ctl" data-run="skip" aria-label="Skip exercise"><i>${ICON.skip}</i>Skip exercise</button>
      </div>
    </div>`;
    if (step.duration != null) {
      const elapsed = R.reenter ? 0 : (paused ? R.pausedAt : Date.now()) - R.stepStart;
      updateClock(step.duration * 1000 - elapsed, step.duration * 1000);
    }
  }

  function updateClock(remaining, total) {
    const clock = document.getElementById('clock');
    const arc = document.getElementById('arc');
    if (clock) clock.textContent = String(Math.max(0, Math.ceil(remaining / 1000)));
    if (arc) arc.setAttribute('stroke-dashoffset', String(RING_C * Math.min(1, Math.max(0, 1 - remaining / total))));
  }

  runEl.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-run]');
    if (!el || !R) return;
    switch (el.dataset.run) {
      case 'pause': pause(); break;
      case 'resume': resume(); break;
      case 'back': backRep(); break;
      case 'skip': skipExercise(); break;
      case 'tap': tapRep(); break;
      case 'now': startNow(); break;
      case 'flags':
        pause();
        openSheet({ type: 'flags' });
        break;
      case 'end': {
        const wasPaused = R.pausedAt != null;
        pause();
        if (confirm('End this session? What you’ve done so far is saved to History.')) finish('ended');
        else if (!wasPaused) resume();
        break;
      }
    }
  });

  // ---------- main views ----------

  function render() {
    closeStale();
    const t = today();
    if (!state.settings.disclaimerAccepted && !sheet) {
      sheet = { type: 'disclaimer', first: true };
      app.inert = true;
      renderSheet();
    }
    app.innerHTML = top() + (view === 'today' ? todayView(t) : view === 'history' ? historyView(t) : routineView(t));
  }

  function top() {
    const tab = (id, label) =>
      `<button class="tab" data-action="view" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${label}</button>`;
    const plus = view === 'routine' ? '<button class="icon-btn" data-action="new" aria-label="New exercise">+</button>' : '';
    return `<header class="top">
      <nav class="tabs" aria-label="Sections">${tab('today', 'Today')}${tab('history', 'History')}${tab('routine', 'Routine')}</nav>
      ${plus}
    </header>`;
  }

  function todayView(t) {
    const now = new Date();
    const date = now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    const day = now.toLocaleDateString(undefined, { weekday: 'long' });
    const s = state.settings;
    const done = E.doneDays(state.sessions);
    const partial = new Set(state.sessions.filter((x) => x.status !== 'completed').map((x) => x.date));
    const streak = E.streak(done, t);
    const week = E.weekOf(t);
    const weekDone = week.filter((d) => done.has(d)).length;
    const status = done.has(t) ? 'Done' : state.active ? 'Started' : 'Not yet';

    const pw = E.programWeek(s.programStart, t, s.programWeeks);
    const day0 = E.diffDays(s.programStart, t) + 1;
    const total = s.programWeeks * 7;
    const pct = Math.max(0, Math.min(100, Math.round((day0 / total) * 100)));
    const program = pw > 0
      ? `<button class="level" data-action="view" data-view="routine" aria-label="Program week ${pw} of ${s.programWeeks}">
          <div class="level-row" aria-hidden="true"><span>Week ${pw} of ${s.programWeeks}</span><span>Day ${Math.min(day0, total)} of ${total}</span></div>
          <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
        </button>`
      : `<div class="level"><div class="level-row"><span>Program starts ${esc(shortDate(s.programStart))}</span></div><div class="bar"><i style="width:0"></i></div></div>`;

    const cols = week.map((d, i) => {
      const v = done.has(d) ? 'full' : partial.has(d) ? 'tiny' : '';
      const label = `${E.fromKey(d).toLocaleDateString(undefined, { weekday: 'long' })}: ${v === 'full' ? 'done' : v === 'tiny' ? 'partly done' : 'not done'}`;
      return `<div class="col${d === t ? ' today' : ''}${d > t ? ' future' : ''}">
        <span class="check" data-v="${v}" role="img" aria-label="${esc(label)}">${TICK}</span>
        <small>${DAY_LETTERS[i]}</small>
      </div>`;
    }).join('');

    const list = enabled();
    const est = Math.max(1, Math.round(E.estimateSeconds(E.buildPlan(list, s)) / 60));
    const label = state.active ? 'Resume today’s session' : done.has(t) ? 'Do it again' : 'Start today’s routine';

    return `<div class="date">${esc(date)}</div><h1>${esc(day)}</h1>
      ${program}
      <div class="stats three">
        <div class="stat"><b>${status}</b><small>Today</small></div>
        <div class="stat"><b>${streak}</b><small>Day streak</small></div>
        <div class="stat"><b>${weekDone}/7</b><small>This week</small></div>
      </div>
      <div class="week-edit" style="margin-top:20px">${cols}</div>
      <div class="start">
        <button class="btn block big" data-action="start" ${list.length ? '' : 'disabled'}>${label}</button>
        <p class="start-sub">${list.length ? `${plural(list.length, 'exercise')} · about ${est} min` : 'No exercises on. Turn some on in Routine.'}</p>
      </div>
      ${done.has(t) && !state.active ? '<p class="all-done">That’s today done. See you tomorrow.</p>' : ''}
      <h2 class="section-label">Today’s routine</h2>
      <div class="list">${list.map((e, i) => `<div class="ex-row">
          <span class="ex-num">${i + 1}</span>
          <div class="habit-body">
            <button class="habit-name" data-action="edit" data-id="${esc(e.id)}">${esc(e.name)}</button>
            <div class="habit-sub">${esc(E.describe(e))}</div>
          </div>
        </div>`).join('')}</div>
      <button class="link" data-action="flags" style="margin-top:12px">Warning signs · when to stop and get seen</button>`;
  }

  function historyView(t) {
    const sessions = state.sessions.slice().sort((a, b) => b.startedAt - a.startedAt);
    const from30 = E.addDays(t, -29);
    const recent = sessions.filter((s) => s.date >= from30);
    const avg = recent.length ? Math.round(recent.reduce((a, s) => a + s.completionPct, 0) / recent.length) : null;
    const withPain = recent.filter((s) => s.painBefore != null && s.painAfter != null);
    const change = withPain.length ? withPain.reduce((a, s) => a + (s.painAfter - s.painBefore), 0) / withPain.length : null;
    const changeText = change == null ? '–' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change).toFixed(1)}`;

    let html = `<div class="date">Last 30 days</div><h1>History</h1>
      <div class="stats three">
        <div class="stat"><b>${recent.length}</b><small>Sessions</small></div>
        <div class="stat"><b>${avg == null ? '–' : avg + '%'}</b><small>Avg done</small></div>
        <div class="stat"><b>${changeText}</b><small>Pain change</small></div>
      </div>`;

    html += `<div class="month-head" style="margin-top:36px">
        <h2 class="section-label" style="margin-top:0">Pain</h2>
        <div class="seg" style="width:150px;margin-top:0">
          <button data-action="range" data-days="7" aria-pressed="${chartRange === 7}">Week</button>
          <button data-action="range" data-days="30" aria-pressed="${chartRange === 30}">Month</button>
        </div>
      </div>${painChart(t)}`;

    html += calendar(t);

    const skips = E.skipCounts(state.sessions).filter((c) => c.skipped > 0);
    if (skips.length) {
      html += `<h2 class="section-label">Skipped</h2><div class="rules">${skips.map((c) =>
        `<p><b>${esc(c.name)}</b> <span>· skipped ${c.skipped} of ${plural(c.total, 'session')}</span></p>`).join('')}</div>`;
    }

    html += `<h2 class="section-label">Sessions</h2>`;
    if (!sessions.length) {
      html += `<div class="empty" style="margin-top:28px"><p>Finished sessions show up here.</p></div>`;
    } else {
      html += `<div class="list" style="margin-top:10px">${sessions.map((s) => {
        const pain = s.painBefore != null || s.painAfter != null ? ` · pain ${s.painBefore ?? '–'} → ${s.painAfter ?? '–'}` : '';
        return `<button class="srow" data-action="session" data-id="${esc(s.id)}">
          <div class="srow-head"><b>${esc(shortDate(s.date))}</b><span>${s.completionPct}%</span></div>
          <div class="srow-sub">${minutes(s.durationSec)}${s.status === 'ended' ? ' · ended early' : ''}${pain}${s.tingling.length ? ' · tingling' : ''}</div>
          <div class="mini" aria-hidden="true"><i style="width:${s.completionPct}%"></i></div>
        </button>`;
      }).join('')}</div>`;
    }
    html += `<button class="row-btn" data-action="csv" style="margin-top:20px">Export history<span>CSV</span></button>`;
    return html;
  }

  function painChart(t) {
    const pts = E.painSeries(state.sessions, t, chartRange);
    if (!pts.length) return `<div class="chart-empty">Log pain in the check-in after a session to see it here.</div>`;
    const W = 320, H = 170, L = 22, B = 22, T = 8, Rr = 6;
    const x = (v) => L + (chartRange === 1 ? 0 : (v / (chartRange - 1)) * (W - L - Rr));
    const y = (v) => T + (1 - v / 10) * (H - T - B);
    const line = (key) => pts.filter((p) => p[key] != null).map((p) => `${x(p.x).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
    const dots = (key, cls) => pts.filter((p) => p[key] != null).map((p) => `<circle class="${cls}" cx="${x(p.x).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="3.5"/>`).join('');
    const from = E.addDays(t, -(chartRange - 1));
    const lab = (k) => E.fromKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const desc = pts.map((p) => `${shortDate(p.date)}: before ${p.before ?? 'not logged'}, after ${p.after ?? 'not logged'}`).join('. ');
    return `<div class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pain over the last ${chartRange} days. ${esc(desc)}">
        ${[0, 5, 10].map((v) => `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="0" y="${y(v) + 4}">${v}</text>`).join('')}
        <text class="axis" x="${L}" y="${H - 4}">${esc(lab(from))}</text>
        <text class="axis" x="${W - Rr}" y="${H - 4}" text-anchor="end">${esc(lab(t))}</text>
        <polyline class="before" points="${line('before')}"/>
        <polyline class="after" points="${line('after')}"/>
        ${dots('before', 'dot-before')}${dots('after', 'dot-after')}
      </svg>
      <div class="legend" aria-hidden="true"><span><i class="b"></i>Before</span><span><i></i>After</span></div>
    </div>`;
  }

  function calendar(t) {
    const [y, m] = calMonth.split('-').map(Number);
    const first = `${calMonth}-01`;
    const daysIn = new Date(y, m, 0).getDate();
    const lead = E.weekday(first);
    const done = E.doneDays(state.sessions);
    const any = new Set(state.sessions.map((s) => s.date));
    const title = new Date(y, m - 1, 15).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const earliest = state.sessions.reduce((min, s) => (s.date < min ? s.date : min), t).slice(0, 7);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<i class="blank"></i>');
    for (let d = 1; d <= daysIn; d++) {
      const k = `${calMonth}-${String(d).padStart(2, '0')}`;
      const cls = done.has(k) ? 'full' : any.has(k) ? 'part' : '';
      const label = `${E.fromKey(k).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}: ${cls === 'full' ? 'done' : cls === 'part' ? 'partly done' : 'no session'}`;
      cells.push(`<i class="${cls}${k === t ? ' today' : ''}" aria-label="${esc(label)}" role="img">${d}</i>`);
    }
    return `<div class="month-head" style="margin-top:36px">
        <h2 class="section-label" style="margin-top:0">${esc(title)}</h2>
        <div class="month-nav">
          <button data-action="month" data-delta="-1" aria-label="Previous month" ${calMonth <= earliest ? 'disabled' : ''}>‹</button>
          <button data-action="month" data-delta="1" aria-label="Next month" ${calMonth >= t.slice(0, 7) ? 'disabled' : ''}>›</button>
        </div>
      </div>
      <div class="cal">${DAY_LETTERS.map((l) => `<span aria-hidden="true">${l}</span>`).join('')}${cells.join('')}</div>`;
  }

  function routineView(t) {
    const s = state.settings;
    const list = exercises();
    const pw = E.programWeek(s.programStart, t, s.programWeeks);
    const onOff = (key, label, hint) => `<button class="row-btn" data-action="toggle" data-key="${key}" aria-pressed="${s[key]}">
        <b>${label}${hint ? `<div class="hint" style="margin-top:2px">${hint}</div>` : ''}</b><span class="${s[key] ? 'on' : ''}">${s[key] ? 'On' : 'Off'}</span></button>`;

    let html = `<div class="date">${pw > 0 ? `Week ${pw} of ${s.programWeeks}` : 'Not started'}</div><h1>Routine</h1>
      <p class="hint">Tap a name to edit. Changes apply to future sessions only.</p>
      <div class="list">${list.map((e, i) => `<div class="ex-row${e.enabled ? '' : ' off'}">
          <button class="check" data-action="enable" data-id="${esc(e.id)}" data-v="${e.enabled ? 'full' : ''}" aria-label="${esc(e.name)}: ${e.enabled ? 'on, tap to turn off' : 'off, tap to turn on'}">${TICK}</button>
          <div class="habit-body">
            <button class="habit-name" data-action="edit" data-id="${esc(e.id)}">${esc(e.name)}</button>
            <div class="habit-sub">${esc(E.describe(e))}</div>
          </div>
          <div class="ex-move">
            <button data-action="move" data-id="${esc(e.id)}" data-delta="-1" aria-label="Move ${esc(e.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button data-action="move" data-id="${esc(e.id)}" data-delta="1" aria-label="Move ${esc(e.name)} down" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        </div>`).join('')}</div>
      <button class="link" data-action="new">+ Add exercise</button>`;

    html += `<h2 class="section-label">During a session</h2><div class="rules" style="margin-top:10px">
      ${onOff('voice', 'Voice cues', '“Hold… 3, 2, 1, relax”')}
      ${onOff('tones', 'Tones', 'Beeps on hold and relax')}
      </div>
      <div class="field" style="margin-top:20px"><span>Moving reps (no hold)</span>
        <div class="seg">
          <button data-action="pace" data-mode="auto" aria-pressed="${s.paceMode === 'auto'}">Auto-pace</button>
          <button data-action="pace" data-mode="tap" aria-pressed="${s.paceMode === 'tap'}">Tap to count</button>
        </div>
      </div>
      ${s.paceMode === 'auto' ? `<div class="stepper">
        <button data-action="set-step" data-key="paceSeconds" data-delta="-1" aria-label="Fewer seconds per rep" ${s.paceSeconds <= 2 ? 'disabled' : ''}>−</button>
        <output>${s.paceSeconds} s per rep</output>
        <button data-action="set-step" data-key="paceSeconds" data-delta="1" aria-label="More seconds per rep" ${s.paceSeconds >= 15 ? 'disabled' : ''}>+</button>
      </div>` : ''}`;

    html += `<h2 class="section-label">Daily reminder</h2><div style="margin-top:10px;border-top:1px solid var(--line)">
      ${s.reminderTimes.map((tm, i) => `<label class="row-time"><span>${s.reminderTimes.length > 1 ? (i === 0 ? 'First' : 'Second') : 'Time'}</span>
        <span style="display:flex;align-items:center"><input type="time" value="${tm}" data-time="${i}">${s.reminderTimes.length > 1 ? `<button data-action="rm-time" data-i="${i}" aria-label="Remove this reminder">Remove</button>` : ''}</span></label>`).join('')}
      </div>
      ${s.reminderTimes.length < 2 ? '<button class="link" data-action="add-time">+ Add a second time</button>' : ''}
      <button class="btn block" data-action="calendar" style="margin-top:12px">Add to Calendar</button>
      <p class="hint">Home-screen web apps can’t schedule their own alerts, so reminders go in your Calendar as a daily event with an alert. If you change the time, delete the old “Neck PT” event first.</p>`;

    html += `<h2 class="section-label">Program</h2><div style="margin-top:10px;border-top:1px solid var(--line)">
      <label class="row-time"><span>Start date</span><input type="date" value="${s.programStart}" data-field="programStart"></label></div>
      <div class="stepper">
        <button data-action="set-step" data-key="programWeeks" data-delta="-1" aria-label="Fewer weeks" ${s.programWeeks <= 1 ? 'disabled' : ''}>−</button>
        <output>${plural(s.programWeeks, 'week')}</output>
        <button data-action="set-step" data-key="programWeeks" data-delta="1" aria-label="More weeks" ${s.programWeeks >= 52 ? 'disabled' : ''}>+</button>
      </div>`;

    html += `<h2 class="section-label">Data</h2><div style="margin-top:10px;border-top:1px solid var(--line)">
      <button class="row-btn" data-action="csv">Export history<span>CSV</span></button>
      <button class="row-btn" data-action="backup">Export backup<span>JSON</span></button>
      <button class="row-btn" data-action="import">Restore from backup<span>JSON</span></button>
      </div>
      <h2 class="section-label">Safety</h2><div style="margin-top:10px;border-top:1px solid var(--line)">
      <button class="row-btn" data-action="disclaimer">Safety guidelines<span>›</span></button>
      <button class="row-btn" data-action="flags">Warning signs<span>›</span></button>
      </div>`;
    return html;
  }

  // ---------- sheets ----------

  let opener = null;

  function openSheet(s) {
    if (!sheet) opener = document.activeElement;
    sheet = s;
    document.body.style.overflow = 'hidden';
    app.inert = true;
    runEl.inert = true;
    renderSheet();
    sheetEl.scrollTop = 0;
    const title = sheetEl.querySelector('#sheet-title');
    if (title) title.focus({ preventScroll: true });
  }

  function closeSheet() {
    sheet = null;
    runEl.inert = false;
    renderSheet();
    if (!R) {
      app.inert = false;
      document.body.style.overflow = '';
    }
    render();
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }

  function renderSheet() {
    if (!sheet) {
      sheetEl.hidden = true;
      sheetEl.innerHTML = '';
      return;
    }
    sheetEl.hidden = false;
    const html = {
      disclaimer: disclaimerSheet,
      flags: flagsSheet,
      edit: editSheet,
      checkin: checkinSheet,
      session: sessionSheet,
    }[sheet.type]();
    sheetEl.innerHTML = `<div class="sheet-inner">${html}</div>`;
  }

  function disclaimerSheet() {
    const first = sheet.first;
    return `${first ? '' : '<div class="sheet-top"><span></span><button class="done" data-action="close">Done</button></div>'}
      <div class="date" style="margin-top:${first ? 28 : 20}px">Neck PT</div>
      <h1 id="sheet-title" tabindex="-1">Before you start</h1>
      <ul class="points">${DISCLAIMER.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <p class="lead">During a session, “Stop &amp; get seen” lists warning signs that need prompt medical attention.</p>
      ${first ? '<div class="form-actions"><button class="btn block" data-action="accept">I understand</button></div>' : ''}`;
  }

  function flagsSheet() {
    return `<div class="sheet-top"><span></span><button class="done" data-action="close">${R ? 'Back to session' : 'Done'}</button></div>
      <h1 id="sheet-title" tabindex="-1" class="detail-name">Stop &amp; get seen</h1>
      <p class="lead">Stop exercising and contact your doctor the same day if you notice:</p>
      <ul class="points flags">${RED_FLAGS.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <div class="warn">These can be signs of pressure on the spinal cord. If symptoms are sudden or severe, go to urgent care or the emergency department.</div>
      <p class="lead" style="margin-top:20px">Sharp pain, or tingling and numbness that get worse during an exercise: stop that exercise.</p>`;
  }

  // --- edit exercise ---

  function editDraft(e) {
    return e ? { ...e } : {
      id: null, name: '', cue: '', type: 'hold-reps', reps: 10, holdSeconds: 5, restSeconds: 3, sideRestSeconds: 10, sides: 'none', enabled: true,
    };
  }

  function stepper(field, value, label, min, max) {
    return `<div class="stepper">
      <button data-action="ed-step" data-field="${field}" data-delta="-1" aria-label="Less ${esc(label)}" ${value <= min ? 'disabled' : ''}>−</button>
      <output>${value}${field === 'reps' ? '' : ' s'}</output>
      <button data-action="ed-step" data-field="${field}" data-delta="1" aria-label="More ${esc(label)}" ${value >= max ? 'disabled' : ''}>+</button>
    </div>`;
  }

  function editSheet() {
    const d = sheet.draft;
    const seg = (action, key, opts) => `<div class="seg">${opts.map(([v, l]) =>
      `<button data-action="${action}" data-val="${v}" aria-pressed="${d[key] === v}">${l}</button>`).join('')}</div>`;
    const unit = d.type === 'hold-sets' ? 'Sets' : 'Reps';
    return `<div class="sheet-top">
        <button data-action="close">Cancel</button>
        <button class="done" data-action="save" ${d.name.trim() ? '' : 'disabled'}>Done</button>
      </div>
      <h1 id="sheet-title" tabindex="-1" class="detail-name">${sheet.id ? 'Edit exercise' : 'New exercise'}</h1>
      <label class="field"><span>Name</span><input type="text" data-ed="name" value="${esc(d.name)}" placeholder="Chin tucks" maxlength="60" autocomplete="off"></label>
      <label class="field"><span>Cue</span><input type="text" data-ed="cue" value="${esc(d.cue)}" placeholder="What to focus on" maxlength="200" autocomplete="off"></label>
      <div class="field"><span>Type</span>${seg('ed-type', 'type', [['hold-reps', 'Hold reps'], ['hold-sets', 'Hold sets'], ['reps', 'Reps']])}</div>
      <div class="field"><span>Sides</span>${seg('ed-sides', 'sides', [['none', 'None'], ['alternating', 'Alternate'], ['each', 'Each side']])}</div>
      <div class="field"><span>${unit}${d.sides !== 'none' ? ' per side' : ''}</span>${stepper('reps', d.reps, unit.toLowerCase(), 1, 50)}</div>
      <div class="field"><span>Hold</span>${stepper('holdSeconds', d.holdSeconds, 'hold', 0, 300)}
        <p class="hint" style="text-align:center">${d.holdSeconds === 0 ? 'No hold: reps are auto-paced or tapped.' : ''}</p></div>
      <div class="field"><span>Rest between ${unit.toLowerCase()}</span>${stepper('restSeconds', d.restSeconds, 'rest', 0, 120)}</div>
      ${d.sides === 'each' ? `<div class="field"><span>Rest when switching sides</span>${stepper('sideRestSeconds', d.sideRestSeconds, 'side rest', 1, 120)}</div>` : ''}
      <p class="hint" style="margin-top:24px">Changes apply to future sessions. Past history keeps what you actually did.</p>
      ${sheet.id ? '<div class="detail-actions"><button class="link danger" data-action="delete-ex">Delete exercise</button></div>' : ''}`;
  }

  function saveExercise() {
    const d = sheet.draft;
    if (!d.name.trim()) return;
    const clean = E.cleanExercise({ ...d, name: d.name.trim(), cue: d.cue.trim() }, 0);
    if (sheet.id) {
      const i = state.exercises.findIndex((e) => e.id === sheet.id);
      if (i !== -1) state.exercises[i] = { ...clean, id: sheet.id, order: state.exercises[i].order };
    } else {
      state.exercises.push({ ...clean, id: `ex-${uid()}`, order: state.exercises.length, enabled: true });
    }
    save();
    closeSheet();
    toast('Saved');
  }

  // --- check-in ---

  function checkinDraft(s) {
    return {
      painBefore: s.painBefore,
      painAfter: s.painAfter,
      worse: s.checkedIn ? s.tingling.length > 0 : null,
      picked: s.tingling.slice(),
      disable: true,
      note: s.note,
    };
  }

  function painField(key, label) {
    const v = sheet.draft[key];
    return `<div class="field">
      <div class="pain-head"><span>${label}</span><output class="${v == null ? 'unset' : ''}" id="out-${key}">${v == null ? '–' : v}</output></div>
      <input type="range" min="0" max="10" step="1" value="${v == null ? 0 : v}" data-pain="${key}" aria-label="${label}, 0 to 10">
      <div class="scale" aria-hidden="true"><span>0 none</span><span>5</span><span>10 worst</span></div>
    </div>`;
  }

  function checkinSheet() {
    const s = sessionById(sheet.id);
    const d = sheet.draft;
    const headline = sheet.fresh
      ? (s.status === 'completed' ? 'Nice work.' : 'Session saved.')
      : 'Check-in';
    const sub = `${s.completionPct}% done · ${minutes(s.durationSec)}`;
    const picked = new Set(d.picked);
    const names = s.results.map((r) => `<button class="chip" data-action="pick" data-id="${esc(r.id)}" aria-pressed="${picked.has(r.id)}">${esc(r.name)}</button>`).join('');
    const stillOn = d.picked.filter((id) => (state.exercises.find((e) => e.id === id) || {}).enabled);
    return `<div class="sheet-top">
        <button data-action="close">${sheet.fresh ? 'Skip' : 'Cancel'}</button>
        <button class="done" data-action="save-checkin">Save</button>
      </div>
      <div class="date" style="margin-top:20px">${esc(sub)}</div>
      <h1 id="sheet-title" tabindex="-1">${headline}</h1>
      <p class="lead">Quick check-in. Everything is optional.</p>
      ${painField('painBefore', 'Pain before')}
      ${painField('painAfter', 'Pain after')}
      <div class="field"><span>Did any exercise make arm tingling or numbness worse?</span>
        <div class="seg">
          <button data-action="worse" data-val="no" aria-pressed="${d.worse === false}">No</button>
          <button data-action="worse" data-val="yes" aria-pressed="${d.worse === true}">Yes</button>
        </div>
        ${d.worse ? `<p class="hint">Which ones?</p><div class="chips">${names}</div>` : ''}
      </div>
      ${d.worse && d.picked.length ? `<div class="warn"><b>Stop the exercise that made it worse.</b>
          Tingling or numbness that gets worse is a sign to stop that exercise and check with your PT or doctor before doing it again.
          ${stillOn.length ? `<button class="link" data-action="disable-toggle" aria-pressed="${d.disable}">${d.disable ? '✓ Turning off' : 'Turn off'} ${esc(stillOn.map((id) => s.results.find((r) => r.id === id).name).join(', '))} in my routine</button>` : '<p class="hint">Already off in your routine.</p>'}
          <button class="link" data-action="flags">See warning signs</button>
        </div>` : ''}
      <label class="field"><span>Note</span><textarea data-ed="note" placeholder="How did it feel?" maxlength="1000">${esc(d.note)}</textarea></label>`;
  }

  function saveCheckin() {
    const s = sessionById(sheet.id);
    const d = sheet.draft;
    s.painBefore = d.painBefore;
    s.painAfter = d.painAfter;
    s.tingling = d.worse ? d.picked.slice() : [];
    s.note = d.note.trim();
    s.checkedIn = true;
    const off = [];
    if (d.worse && d.disable) {
      for (const id of d.picked) {
        const e = state.exercises.find((x) => x.id === id);
        if (e && e.enabled) { e.enabled = false; off.push(e.name); }
      }
    }
    save();
    const fresh = sheet.fresh;
    if (fresh) closeSheet(); else openSheet({ type: 'session', id: s.id });
    toast(off.length ? `Turned off: ${off.join(', ')}` : 'Saved');
  }

  // --- session detail ---

  function sessionSheet() {
    const s = sessionById(sheet.id);
    if (!s) return '';
    const started = new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const name = (id) => (s.snapshot.find((e) => e.id === id) || { name: id }).name;
    return `<div class="sheet-top"><span></span><button class="done" data-action="close">Done</button></div>
      <div class="date" style="margin-top:20px">${esc(started)}${s.status === 'ended' ? ' · ended early' : ''}</div>
      <h1 id="sheet-title" tabindex="-1">${esc(shortDate(s.date))}</h1>
      <div class="stats">
        <div class="stat"><b>${s.completionPct}%</b><small>Done</small></div>
        <div class="stat"><b>${Math.round(s.durationSec / 60)}m</b><small>Time</small></div>
        <div class="stat"><b>${s.painBefore ?? '–'}</b><small>Pain before</small></div>
        <div class="stat"><b>${s.painAfter ?? '–'}</b><small>Pain after</small></div>
      </div>
      <h2 class="section-label">Exercises</h2>
      <div class="results">${s.results.map((r) => `<p><b>${esc(r.name)}</b><span>${r.repsDone}/${r.repsTarget}${r.status === 'done' ? '' : ` · ${r.status}`}</span></p>`).join('')}</div>
      ${s.tingling.length ? `<h2 class="section-label">Tingling worse</h2><p class="note">${esc(s.tingling.map(name).join(', '))}</p>` : ''}
      ${s.note ? `<h2 class="section-label">Note</h2><p class="note">${esc(s.note)}</p>` : ''}
      <div class="detail-actions">
        <button class="link" data-action="edit-checkin">Edit check-in</button>
        <button class="link danger" data-action="delete-session">Delete session</button>
      </div>`;
  }

  // ---------- events ----------

  function handle(el) {
    const id = el.dataset.id;
    const s = state.settings;
    switch (el.dataset.action) {
      case 'view':
        view = el.dataset.view;
        render();
        window.scrollTo(0, 0);
        break;
      case 'start':
        beginSession();
        break;
      case 'flags':
        openSheet({ type: 'flags' });
        break;
      case 'disclaimer':
        openSheet({ type: 'disclaimer' });
        break;
      case 'accept':
        s.disclaimerAccepted = true;
        save();
        closeSheet();
        break;
      case 'close':
        if (sheet && sheet.type === 'disclaimer' && sheet.first) return;
        if (sheet && sheet.type === 'checkin' && !sheet.fresh) openSheet({ type: 'session', id: sheet.id });
        else closeSheet();
        break;
      // routine
      case 'new':
        openSheet({ type: 'edit', id: null, draft: editDraft(null) });
        break;
      case 'edit': {
        const e = state.exercises.find((x) => x.id === id);
        if (e) openSheet({ type: 'edit', id, draft: editDraft(e) });
        break;
      }
      case 'enable': {
        const e = state.exercises.find((x) => x.id === id);
        e.enabled = !e.enabled;
        save();
        render();
        break;
      }
      case 'move': {
        const list = exercises();
        const i = list.findIndex((e) => e.id === id);
        const j = i + Number(el.dataset.delta);
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        list.forEach((e, k) => (e.order = k));
        save();
        render();
        break;
      }
      case 'toggle':
        s[el.dataset.key] = !s[el.dataset.key];
        save();
        render();
        break;
      case 'pace':
        s.paceMode = el.dataset.mode;
        save();
        render();
        break;
      case 'set-step': {
        const k = el.dataset.key;
        const lim = k === 'paceSeconds' ? [2, 15] : [1, 52];
        s[k] = Math.min(lim[1], Math.max(lim[0], s[k] + Number(el.dataset.delta)));
        save();
        render();
        break;
      }
      case 'add-time':
        s.reminderTimes.push('18:00');
        save();
        render();
        break;
      case 'rm-time':
        s.reminderTimes.splice(Number(el.dataset.i), 1);
        save();
        render();
        break;
      case 'calendar':
        addToCalendar();
        break;
      case 'csv':
        if (!state.sessions.length) { toast('No sessions yet'); return; }
        shareFile(E.toCsv(state.sessions), `neck-pt-history-${today()}.csv`, 'text/csv', 'Neck PT history');
        break;
      case 'backup':
        shareFile(JSON.stringify(state, null, 2), `neck-pt-backup-${today()}.json`, 'application/json', 'Neck PT backup');
        break;
      case 'import':
        importData();
        break;
      // history
      case 'range':
        chartRange = Number(el.dataset.days);
        render();
        break;
      case 'month': {
        const [y, m] = calMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + Number(el.dataset.delta), 1);
        calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        render();
        break;
      }
      case 'session':
        openSheet({ type: 'session', id });
        break;
      // edit sheet
      case 'ed-type':
        sheet.draft.type = el.dataset.val;
        if (el.dataset.val === 'hold-sets' && sheet.draft.holdSeconds < 10) { sheet.draft.holdSeconds = 20; sheet.draft.restSeconds = 10; sheet.draft.reps = 3; }
        if (el.dataset.val === 'reps' && !sheet.id) sheet.draft.holdSeconds = 0;
        renderSheet();
        break;
      case 'ed-sides':
        sheet.draft.sides = el.dataset.val;
        renderSheet();
        break;
      case 'ed-step': {
        const f = el.dataset.field;
        const sign = Number(el.dataset.delta);
        const cur = sheet.draft[f];
        const big = f !== 'reps' && (sign > 0 ? cur >= 10 : cur > 10);
        const lim = { reps: [1, 50], holdSeconds: [0, 300], restSeconds: [0, 120], sideRestSeconds: [1, 120] }[f];
        sheet.draft[f] = Math.min(lim[1], Math.max(lim[0], cur + sign * (big ? 5 : 1)));
        renderSheet();
        break;
      }
      case 'save':
        saveExercise();
        break;
      case 'delete-ex': {
        const e = state.exercises.find((x) => x.id === sheet.id);
        if (!e || !confirm(`Delete “${e.name}” from your routine? Past sessions keep their record of it.`)) return;
        state.exercises = state.exercises.filter((x) => x.id !== e.id);
        exercises().forEach((x, k) => (x.order = k));
        save();
        closeSheet();
        break;
      }
      // check-in
      case 'worse':
        sheet.draft.worse = el.dataset.val === 'yes';
        renderSheet();
        break;
      case 'pick': {
        const p = sheet.draft.picked;
        sheet.draft.picked = p.includes(id) ? p.filter((x) => x !== id) : p.concat(id);
        renderSheet();
        break;
      }
      case 'disable-toggle':
        sheet.draft.disable = !sheet.draft.disable;
        renderSheet();
        break;
      case 'save-checkin':
        saveCheckin();
        break;
      case 'edit-checkin': {
        const ss = sessionById(sheet.id);
        openSheet({ type: 'checkin', id: ss.id, draft: checkinDraft(ss), fresh: false });
        break;
      }
      case 'delete-session':
        if (!confirm('Delete this session from your history?')) return;
        state.sessions = state.sessions.filter((x) => x.id !== sheet.id);
        save();
        closeSheet();
        break;
    }
  }

  document.addEventListener('click', (ev) => {
    if (runEl.contains(ev.target)) return;
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    // Flags opened from inside the check-in should come back to it.
    if (el.dataset.action === 'flags' && sheet && sheet.type === 'checkin') {
      const back = sheet;
      sheet = null;
      openSheet({ type: 'flags', back });
      return;
    }
    if (el.dataset.action === 'close' && sheet && sheet.type === 'flags' && sheet.back) {
      openSheet(sheet.back);
      return;
    }
    handle(el);
  });

  sheetEl.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!sheet) return;
    if (t.dataset.ed) {
      sheet.draft[t.dataset.ed] = t.value;
      const btn = sheetEl.querySelector('[data-action="save"]');
      if (btn) btn.disabled = !sheet.draft.name || !sheet.draft.name.trim();
    }
    if (t.dataset.pain) {
      sheet.draft[t.dataset.pain] = Number(t.value);
      const out = document.getElementById(`out-${t.dataset.pain}`);
      out.textContent = t.value;
      out.classList.remove('unset');
    }
  });

  sheetEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.dataset.ed && ev.target.tagName === 'INPUT' && sheet.type === 'edit') {
      ev.preventDefault();
      saveExercise();
    }
  });

  app.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.time != null && /^\d{2}:\d{2}$/.test(t.value)) {
      state.settings.reminderTimes[Number(t.dataset.time)] = t.value;
      save();
    }
    if (t.dataset.field === 'programStart' && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) {
      state.settings.programStart = t.value;
      save();
      render();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (sheet && !(sheet.type === 'disclaimer' && sheet.first)) {
      if (sheet.type === 'flags' && sheet.back) openSheet(sheet.back);
      else closeSheet();
    } else if (R) {
      if (R.pausedAt == null) pause(); else resume();
    }
  });

  // Pause when the app goes to the background: timers don't run there, and you
  // shouldn't be counted as holding a stretch you can't see.
  function checkDay() {
    const t = today();
    if (t !== lastToday) {
      lastToday = t;
      if (!R) render();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (R) pause(); }
    else { checkDay(); if (R) lockScreen(); }
  });
  window.addEventListener('pagehide', () => { if (R) pause(); });
  setInterval(checkDay, 60000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
  // A session that was interrupted today (reload, app closed) picks up paused.
  if (state.active && state.active.date === today() && state.settings.disclaimerAccepted) {
    toast('Session in progress · tap Resume');
  }
})();
