# nerdyBarde

**A web app that listens to your violin and tells you, note by note, whether you're in tune.**

👉 **[Try it in your browser](https://aqrec.github.io/nerdyBarde/)**. No install, nothing to download. Works in Chrome, Edge, Firefox, and Safari.

![demo](./documents/media/demo.png)

---

## What it does

- **Practice trainer.** Loads a sheet-music file, highlights one note at a time, and only moves to the next one once you've played the current note in tune.
- **Tuner.** Four big buttons (G · D · A · E) tune the open strings to **pure, beatless fifths**. Or play freely and it tells you what note you're on and how sharp/flat you are.
- **Intonation that fits the violin.** Judges pitch with **Pythagorean** (melodic) intonation by default, the tuning that matches the violin's own ringing open strings, with just and equal temperament a click away. Watch which open string your note is *ringing*, the way violinists actually check pitch.
- **Visual feedback.** A "ghost notehead" floats above the staff at your actual pitch, so you can see at a glance whether you're hitting the target or drifting half a step away.

## Quick start

1. Open **[the app](https://aqrec.github.io/nerdyBarde/)**.
2. Click **Enable Microphone** and allow access.
3. The default scales practice loads automatically. Or click **Load Score** to use your own MusicXML / MXL file.
4. Bow the highlighted note. Hold it in tune for a fraction of a second and the cursor advances by itself.

That's the whole loop. The settings in the toolbar fine-tune *how strict* and *how patient* the app is.

## Modes (and how to switch)

You can flip between modes any time during a session:

| To do this... | ...do this |
|---|---|
| Tune a specific open string | Click the **G3 / D4 / A4 / E5** button |
| Stop tuning, go back to practice | Click the active string button again, or **long-press** any note on the score |
| Jump to a specific spot in the piece | **Long-press** that note (≈ ½ second hold) |
| Practice only a section | Set **From** / **To** measures, then **Apply Section**. The cursor will loop in that range |
| Recover from a wrong setting | Click **Reset defaults** |

### Keyboard shortcuts

- `→` / `←` &nbsp; Next / previous note
- `R` &nbsp; Restart current section
- `M` &nbsp; Toggle microphone
- `D` &nbsp; Toggle reference drone

## How strict should the app be?

The two key knobs:

- **Tolerance (± cents):** how close to perfect counts as "in tune"
- **Hold time (ms):** how long you must hold the note before it counts

A suggested ramp as you get better:

| Stage | Tolerance | Hold time |
| --- | --- | --- |
| Beginner (slow practice) | ± 20 ¢ | 400 ms |
| Standard (default) | ± 10 ¢ | 150 ms |
| Advanced | ± 5 ¢ | 100 ms |
| Performance tempo | ± 5 ¢ | 30 – 60 ms |

The **A4 reference** input is for orchestras tuning to 441/442 Hz or baroque ensembles at 415.

## Intonation: judged the way a violin is

Most tuners score you against **equal temperament (12-TET)**, the compromise tuning a piano is stuck with. A violin isn't: you tune by ear, and the instrument tells you when a note is right through **ringing open strings** and **beatless double stops**. Those reward *pure* intervals, not 12-TET ones. nerdyBarde lets you practice that way.

### Tuning system

Pick one in the toolbar (**Intonation**):

| System | What it does | Reach for it when… |
| --- | --- | --- |
| **Pythagorean (melodic)** (*default*) | Pure 3:2 fifths stacked from the tonic. Wide major thirds (+8¢), **high leading tones**. | …practicing scales and shaping expressive solo lines (most of the time) |
| **Just (harmonic)** | Low-whole-number ratios to the tonic. **Low major thirds (−14¢)**, pure triads. | …chords, double stops, blending in an ensemble |
| **Equal temperament** | Every semitone is exactly 100¢, matching a piano. | …playing along with a piano or other fixed-pitch instrument |

The same note can sit in very different places. In G major the third (B) is **+8¢** in Pythagorean but **−14¢** in just. That's not an error; it's the difference between a melody that *leads* and a chord that *locks*.

**Why Pythagorean is the default.** A violin's four open strings are themselves a chain of pure fifths (G, D, A, E) that *is* the Pythagorean skeleton. So Pythagorean is the one system that never fights the instrument: the notes that match an open string ring freely, and the strongest sympathetic resonances (octaves, fifths, fourths) line up with it. It's also the standard intonation taught for **melodic** playing and scales, which is most of what you practice here. Switch to **just** when you're working on double stops or chordal passages, and to **equal** only when you must lock to a piano.

### Tuning vs. finger placement (two different things)

Choosing an intonation system **never changes how the open strings are tuned.** There are two separate layers:

1. **Tuning the instrument.** The open strings are *always* pure, beatless fifths (the G·D·A·E buttons). This is physics, not a style: it's how every violin is tuned. (Those pure fifths are the very same 3:2 the Pythagorean system is built from, which is exactly why Pythagorean and the open strings always agree, and why the open strings don't "belong" to any one melodic system: they're the shared foundation underneath all of them.)
2. **Finger placement.** *Where* you put each finger relative to the key's tonic. This is what the intonation system controls.

A subtle but real consequence: because Pythagorean **is** the open-string framework, its notes agree with the open strings. Just intonation uses pure *thirds*, which can sit slightly off the open-string grid, so advanced players often *avoid* open strings in expressive just-intonation passages, because an open string can't bend to match. The app mirrors this faithfully: the open-string ring is your universal check, while the chosen system only moves your fingered targets.

### Tonic

Pythagorean and just are measured *from the key's tonic*. **Tonic → Auto** reads it from the score's key signature and follows key changes; or pick a note to set it yourself. Equal temperament ignores the tonic.

### Open-string ring

Under the needle, the **Open strings** readout shows which of G · D · A · E your note is making *resonate*, and how close you are to a **beatless lock** (it glows green). This is the violin checking itself, independent of the chosen system. Even the open strings aren't equal-tempered: tuned in pure fifths, the E string sits ~2¢ above its 12-TET pitch, which is why a perfectly *ringing* E can still read "+2¢" on an equal-tempered meter.

### Drone

**Drone** (or press `D`) sounds a soft tonic-and-fifth reference, like a fiddle drone or tanpura. Play against it and listen for the beats to slow and stop: a built-in double stop for training pure intervals by ear.

> **Use headphones for the drone.** The drone is for your *ears*; the microphone is for your *violin*. If the drone plays through speakers, the mic hears it too, and since a tonic-plus-fifth drone is a chord (e.g. G + D + G, a 2:3:4 ratio), its combined waveform's true fundamental sits an octave below the tonic. So the tuner may read **G2** while the drone is rooted on G3. That's the acoustic "missing fundamental," not a bug. Headphones keep the drone out of the mic so it tracks only what you play.

> The pure systems use a single tonic and standard Pythagorean / 5-limit just ratios, so they're a faithful guide for scales and melodies rather than chord-by-chord adaptive tuning. The open-string ring works in any key.

## Reading the colors

The big detected-note panel and the on-staff "ghost notehead" share one color code:

| Color | Meaning |
| --- | --- |
| 🟢 Green | You're on the target note, within tolerance |
| 🟠 Orange | Right note but **a little sharp** |
| 🔵 Blue | Right note but **a little flat** |
| 🔴 Red | Wrong note, **above** the target |
| ⚪ Gray | Wrong note, **below** the target |

## Things to know

- **Single notes only.** If the music has double-stops or chords, only the highest note in each chord is checked. Single-line violin parts work best.
- **Treble clef only.** The on-staff ghost notehead assumes treble clef (which is what violin uses).
- **Settings live in the URL, not the browser.** Your toolbar choices are mirrored in the address bar (see [URL parameters](#url-parameters)), so a reload keeps them and you can bookmark or share a configured setup. Open the plain page with no parameters for a clean default start.
- **No metronome.** This tool measures pitch, not rhythm. It won't complain if you play slowly, as long as the notes are in tune.
- **Privacy:** all audio and score processing happens in your browser. **Nothing is uploaded anywhere.** You can disconnect from the internet after loading the page and it still works.

---

## For developers

The app is a static site with no build step and no backend. To run it locally:

```bash
git clone https://github.com/AqRec/nerdyBarde
cd nerdyBarde
python3 -m http.server 8000   # or: npx --yes serve .
```

Open `http://localhost:8000` (not `http://0.0.0.0:8000`, since browsers block microphone access on non-secure origins).

Source layout:

```
index.html           UI shell
src/app.js           State, events, pitch handler, on-score overlay, tuner + intonation UI, drone
src/score.js         OpenSheetMusicDisplay wrapper (load, cursor, sections, per-note key signature)
src/pitch.js         Web Audio + pitchy fundamental-frequency detection
src/intonation.js    Tuning systems (ET / Pythagorean / just) + open-string sympathetic resonance
src/styles.css       Dark theme + responsive layout
test-files/          Bundled sample scores (auto-loaded by default)
```

### URL parameters

Every toolbar setting is mirrored in the address bar as you change it, so you can bookmark or share a fully configured setup. Open the page with any of these and the controls start there:

- `?score=path/to/file.musicxml` &nbsp; Load a different score on page open. Must be a repo-relative path or a public HTTPS URL, **not** a local file path (see the note below).
- `?score=none` &nbsp; Skip the auto-load entirely.
- `?system=pythagorean|just|equal` &nbsp; Intonation system.
- `?tonic=auto|0..11` &nbsp; Tonic for the pure systems (`0`=C, `1`=C&#9839;/D&#9837;, … `11`=B; `auto` reads the score's key signature).
- `?tol=10` &nbsp; Tolerance in cents (1 to 50).
- `?hold=150` &nbsp; Hold time in milliseconds.
- `?a4=440` &nbsp; A4 reference in Hz (415 to 466).
- `?from=5&to=12` &nbsp; Practice section as a measure range (applied once the score loads).
- `?drone=1` &nbsp; Arm the reference drone. It starts on your first click or keypress, since browsers block audio until you interact with the page.

Only values that differ from the defaults appear in the URL, so a fresh setup stays clean. Combine them freely, for example `?system=just&tonic=2&tol=5&from=9&to=16`.

> `?score=` only accepts URLs the browser can fetch over HTTP: repo-relative paths or a public HTTPS URL with CORS. Local filesystem paths (`/Users/...`, `C:\\...`) never work in any browser by design. Use **Load Score** for one-off local files.

### Built with

- [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) (BSD-3-Clause, © 2019 PhonicScore) for score rendering and the practice cursor
- [pitchy](https://github.com/ianprime0509/pitchy) (0BSD, © Ian Johnson) for autocorrelation pitch detection

Both are loaded from [esm.sh](https://esm.sh) at runtime, so the project itself has no `node_modules`.

## License

[MIT](LICENSE) © 2026 AqRec

## Support nerdyBarde

If this saved you some practice frustration, a small tip keeps the project alive.

| Coin | Address |
| --- | --- |
| BTC | `bc1qjzpwhp9ck5qpc05auzw6nna3usc97jad559x8l` |
| XMR | `851XQWiNdA3iZPHY1azmsMEbwUUdx6qbwLYUrgW62EMnbgfJ1RdXmcuCwfYW1fx5EeW6kHbGvynZHeALURQiMhtPPCpcwQN` |
