# Neck PT

A daily neck routine for cervical spondylosis that runs the session for you: it reads out each exercise, times the holds, counts reps and sides, and keeps your history. Same look and setup as Habito: black and white, no account, works offline.

## Use it

```sh
npm start          # http://localhost:8080
npm test           # engine tests
```

No dependencies and no build step. To put it on your iPhone, host the folder on any static host (GitHub Pages works: Settings → Pages → deploy from this branch), open it in Safari, then Share → Add to Home Screen. It runs full-screen and offline. Data stays on the device; use Routine → Export backup to keep a copy.

## The session

Tap **Start today’s routine** and put the phone face-up on a table. For each exercise:

1. **Next up** card (8 s): the name and cue are read aloud. Tap *Start now* to skip ahead.
2. **Get ready** (3 s), with the side called out ("Left side").
3. **Hold**: a big countdown ring; "Hold… 3, 2, 1" then a tone and "Relax". Long holds also get a "10 seconds" call.
4. **Rest** (3 s between reps, 10 s between sets and when switching sides), then the next rep.

Moving reps with no hold (wall angels) are either auto-paced (one every 4 s, counted aloud) or tap-to-count with a big +1 button. Choose in Routine.

Controls: Pause/Resume, Back one rep, Skip exercise, End. **Stop & get seen** pauses and lists the warning signs.

- The screen stays awake (Screen Wake Lock, iOS 16.4+).
- Switching away from the app pauses the session. Closing or reloading the app keeps your place; reopen and tap Resume.
- A session left unfinished on an earlier day is saved to History as "ended early".

After the session there's an optional check-in: pain before and after (0–10), whether any exercise made arm tingling or numbness worse (with an offer to turn that exercise off), and a note.

## Differences from the original spec

Built as a home-screen web app like Habito instead of Expo, so:

- **Reminders** go through Calendar. Routine → Add to Calendar creates a daily "Neck PT" event with an alert (one or two times a day). iPhone home-screen web apps can't schedule their own notifications.
- **Haptics**: iPhone Safari has no vibration API, so cues are tones and voice instead. Android phones also vibrate.
- **Voice and tones** use the Web Speech and Web Audio APIs. If you hear nothing, check the ringer switch and volume.

## How it works

- `engine.js` is pure logic with tests. It compiles the enabled exercises into a flat list of timed steps (intro → ready → hold → rest …). The app walks that list using wall-clock time, so pausing, going back a rep and resuming after a reload stay accurate.
- Each session stores a snapshot of the exercises as they were when it started. Editing the routine only changes future sessions.
- `app.js` handles the UI and saves to `localStorage` (`neckpt:v1`). Saved and imported data is checked when it loads. Anything that can't be read is kept under a `neckpt:v1:unreadable:*` key instead of being overwritten.
- `sw.js` caches the app for offline use. Bump `CACHE` when you ship changes.

This app times and logs the routine your clinician gave you. It isn't medical advice.
