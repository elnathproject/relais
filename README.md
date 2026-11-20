# Relais

Relais is an Android timer for performers. A **piece** is a chain of countdowns: when one reaches zero, the next one starts by itself, each with its own background and digit colours. Pieces are kept in **setlists**, played in order: a title screen before each piece, and the next title as soon as a piece ends. The digits are drawn as seven-segment LED figures and fill the whole screen, as in its sibling app [Élan](https://github.com/elnathproject/ELAN).

## Screenshots

<p>
  <img src="docs/screenshots/1-setlists.png" width="200" alt="Setlists, with a Start button for each setlist and each piece">
  <img src="docs/screenshots/2-editor.png" width="200" alt="Editing a piece: length and colours of each countdown">
  <img src="docs/screenshots/3-title.png" width="200" alt="Title screen of a piece, with the seek bar set to start from 20:00">
  <img src="docs/screenshots/4-countdown.png" width="200" alt="Second countdown of the piece, in its own colours">
</p>

From left: the setlists; editing a piece; the title of a piece, waiting for the pedal, with the head of the bar set to start from 20:00; the second countdown of the piece, in its own colours.

<p>
  <img src="docs/screenshots/5-countdown-landscape.png" width="410" alt="Countdown in landscape">
</p>

## Features

- **Sequential countdowns.** Each piece holds up to 99 countdowns, from one second to 999:59. At zero the next countdown starts without any input.
- **Timers.** Besides countdowns, a piece can hold timers: sections of open length that count up from 0:00 until the performer moves on. Hold the right pedal for 2 seconds (a ring fills meanwhile), or tap *Next ›*, to go to the next section; a short press pauses and resumes. In the coloured bars a timer is striped.
- **Colours per countdown.** Every countdown has its own background and digit colour, chosen freely or from ready-made pairs, so the sections of a piece can be told apart at a glance.
- **Blinking in time.** When a new countdown begins, its digits blink for three seconds in step with the seconds: each new value appears lit at the instant it changes, so the count is never hidden.
- **Setlists played in order.** Start a setlist and every piece opens on its title, shown full screen and static until you start it. When the last countdown of a piece ends, the title of the next piece appears; after the last piece, an end screen.
- **Start from any point.** On the title of a piece, the coloured bar works like the progress bar of an audio player: tap or drag the head, or step it a second at a time, and Start begins from that point, for example from 0:31, in the colours of the countdown it falls in. Reset brings back the same point, to rehearse a passage again; the next piece of a setlist starts from 0:00.
- **Single pieces.** Start a piece on its own and it stops at 00:00 when its last countdown ends.
- **Foot pedal.** A Bluetooth page-turner pedal, like those used for PDF scores, controls the player. On a title, right starts the piece. On a countdown, right pauses and resumes, left resets to the title. On a timer, a short press of right pauses and resumes, holding it for 2 seconds moves on. Holding needs a pedal that keeps reporting the key while pressed, as most do; *Next ›* on screen works in any case. Arrow keys, Page Up/Down, Space and Enter are all recognised, so any pedal mode pieces, as does a Bluetooth keyboard.
- **Ordering.** Setlists, pieces and countdowns can be moved up and down; pieces and countdowns can be duplicated.
- **Import and export.** Each setlist, or the whole library, can be saved as a JSON file and imported on another device. Importing adds the setlists in the file to those already there.
- **Silent by default.** Sound starts off every time the player opens. Turn it on to get a double tone and a vibration at each change.
- **Screen stays on** for as long as the app is open.
- **Works offline.** The app does not request internet access and collects no data.
- **Instructions at hand.** The "i" icon at the top of the setlists explains pieces and setlists, the seek bar, the pedal and export and import, and shows the version and the author.

Time is always computed from the system clock rather than by counting ticks, so it stays accurate even if the phone slows the app down.

## For ensembles: web version

The `web/` folder holds a web version for a group of musicians: a conductor plays the setlists exported from the app on a password-protected page, and the performers follow the same screens full screen on their phones or tablets, by opening an address or scanning a QR code, with no app to install. All displays change countdown together. It runs on ordinary PHP web hosting; see [web/README.md](web/README.md).

## Exchange file

```json
{
  "format": "relais-setlists",
  "version": 1,
  "setlists": [
    { "name": "Setlist 1",
      "pieces": [
        { "name": "Piece 1",
          "segments": [ { "s": 450, "bg": "#0d0f10", "fg": "#f2a541" },
                        { "s": 300, "bg": "#0b1a33", "fg": "#6fb7ff" } ] } ] }
  ]
}
```

A timer is written `{ "t": "timer", "bg": "#14301f", "fg": "#4cff7a" }`, with no length. `s` is the length in seconds, `bg` and `fg` the background and digit colours. Values out of range are corrected on import; a file without setlists is refused.

## Installing

Every change pushed to the `main` branch triggers an automatic build, which you can follow in the repository's **Actions** tab; the APK of each build is kept there as an artifact. Each version tagged `vX.Y.Z` also gets a release with `Relais.apk` on the **Releases** page.

To install it on your phone:

1. Download `Relais.apk` on the phone.
2. Open the downloaded file. The first time, Android asks you to allow installs from that source (your browser or file manager): allow it.
3. Google Play Protect may warn that the developer is unknown; choose to install anyway.

To update, install the new APK over the old one. If Android refuses because the signature differs, export your setlists first, uninstall the old version, install the new one and import them again: the setlists are stored inside the app and are lost when it is uninstalled.

## Project structure

- `app/src/main/assets/index.html`: the app itself, meaning the setlists, the editor, the player, the digit drawing and the timing logic. It also runs in a desktop or mobile browser for quick testing.
- `app/src/main/java/com/ciccarelli/relais/MainActivity.kt`: the Android window that hosts the page full screen, keeps the screen on, handles vibration, the back button and the system file picker for import and export, and opens external links in the browser.
- `app/src/main/AndroidManifest.xml`: name, icon, automatic rotation and permissions (vibration only).
- `.github/workflows/build.yml`: the automatic build on GitHub.
- `web/`: the web version for ensembles (conductor and displays), described in its own README.
- `docs/screenshots/`: the images of this page.
- `LICENSE`: the MIT License.


## Credits

Designed and built by Alessandro Ciccarelli (Elnath Project), [alessandrociccarelli.com](https://alessandrociccarelli.com). © 2026.

## License

Relais is released under the [MIT License](LICENSE).
