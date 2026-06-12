# nerdyBarde

**A web app that listens to your violin and tells you, note by note, whether you're in tune.**

👉 **[Try it in your browser](https://aqrec.github.io/nerdyBarde/)**. No install, nothing to download. Works in Chrome, Edge, Firefox, and Safari.

![demo](./documents/media/demo.png)

---

## What it does

- **Practice trainer.** Loads a sheet-music file, highlights one note at a time, and only moves to the next one once you've played the current note in tune.
- **Tuner.** Four big buttons (G · D · A · E) tune the open strings. Or play freely and it tells you what note you're on and how sharp/flat you are.
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
- **Settings don't persist** between visits; they reset to defaults each time you reload.
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
src/app.js           State, events, pitch handler, on-score overlay, tuner UI
src/score.js         OpenSheetMusicDisplay wrapper (load, cursor, sections)
src/pitch.js         Web Audio + pitchy fundamental-frequency detection
src/styles.css       Dark theme + responsive layout
test-files/          Bundled sample scores (auto-loaded by default)
```

### URL parameters

- `?score=path/to/file.musicxml` &nbsp; Load a different score on page open.
- `?score=none` &nbsp; Skip the auto-load entirely.

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
