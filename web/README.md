# Relais for ensembles

The web version of Relais for a group of musicians: a conductor controls the pieces from a password-protected page, and the performers follow them full screen on their phones or tablets by opening an address, or by scanning a QR code. Nothing to install on the devices: any recent browser pieces.

Everything works as in the app. A piece opens on its title, static until the conductor starts it, from 0:00 or from any point chosen on the coloured seek bar. Its countdowns follow one another, each in its own colours, blinking in time at every change. Within a setlist, the title of the next piece appears as soon as a piece ends; after the last one, an end screen. A single piece stops at 00:00. A Bluetooth page-turner pedal or a keyboard works on the conductor's page as in the app.

## How it stays in time

The server never sends the remaining seconds. It sends the piece (lengths and colours of its countdowns), the start position and the instants at which the run starts and pauses. Every display computes the current countdown from its own clock, corrected by its offset from the server's clock. Every command takes effect one second after it is given (`SYNC_DELAY_MS` in `config.php`), so all displays change together. In a test with three displays, two of them with clocks five seconds fast and three seconds slow, they changed countdown within a few milliseconds of each other.

The end of a piece is computed the same way: the server also sends the next piece of the setlist, and every display shows its title as soon as the current piece ends, even if the conductor's page is asleep at that moment.

A display that reloads, or whose screen turns off and on again, shows the right screen at once.

## Requirements

Web hosting with PHP 7.4 or later, shared hosting included. No database: the state is a small JSON file in `data/`. The protections use `.htaccess`, so they apply on Apache; on nginx they must be repeated in the server configuration. HTTPS is required: the server answers nothing over plain `http://`.

## Installation

1. In `config.php`, replace `changeme` with a password for the conductor: at least 8 characters, better a phrase of a few words, not used anywhere else. Optionally set an ensemble code.
2. Upload the whole `web` folder to the server by FTP, including the hidden `.htaccess` files, with a name of your choice (for example `relais`). Folders 755, files 644.
3. Check the protections: `https://yoursite.com/relais/data/state.json` must answer *Forbidden* (403), not show its content.
4. Open the conductor's page with the `https://` address. A red band at the top lists what is wrong on the server, if anything (permissions too wide, missing protection files, password too short).

## Use

- **Setlists.** Prepare them in the Relais app, tap *Export* at the top of the setlists, and import that file on the conductor's page with *Import setlists*. The page keeps them in that browser; importing again replaces them.
- **Conductor:** open `director.html` (for example `https://yoursite.com/relais/director.html`) and enter the password. *Remember on this computer* keeps you logged in for 30 days; otherwise the session ends when the tab is closed, or after 12 hours. *Log out* ends it at once. Several devices can control the same timer.
- **Starting.** *▶ Start* on a setlist sends the title of its first piece to every display; the ▶ of a single piece sends that piece alone. On a title, move the head of the seek bar (or step it with − and +) to start from a later point, then start with the pedal or *Start*. *‹ Prev* and *Next ›* change piece on a title.
- **Pedal or keyboard (conductor).** On a title, right or down arrow, Page Down, Space or Enter start the piece. On a countdown, the same keys pause and resume; left or up arrow, Page Up reset to the title of the piece, at the same start position. Left does nothing on a title, so a stray press on stage never changes the piece.
- **Performers:** open the folder address (`https://yoursite.com/relais/`). On the conductor's page, *QR code* shows it as a large QR code to scan from the conductor's screen (with the ensemble code, if set); *Settings* shows it as text with a *Copy* button. One tap shows the timer full screen and keeps the screen on.
- **Opening and closing:** the performers see the timer only while it is open. Logging in as conductor opens it; *Log out* closes it, and the displays go back to a waiting page that opens again by itself. If the conductor's page loses the connection (computer asleep, network down) the timer stays visible for two hours, then closes (`CLOSE_AFTER_MINUTES` in `config.php`). While closed, the server tells visitors nothing. *Clear the displays*, in Settings, sends them back to the waiting screen without closing.
- **Ensemble code:** if `ENSEMBLE_CODE` is set, the address for the performers carries it (`…/relais/?code=4719`) and the displays show nothing without it. Without a code, anyone who knows the address can watch the timer, but only the conductor can control it.
- **Vibration:** in Settings, the performers' phones can vibrate at every change of countdown and at the end of a piece (Android phones in Chrome and similar browsers, not iPhone).
- The top bar of the conductor's page shows how many displays are connected.

## Security

The protections are those of Élan's web version, tested the same way.

- **Password.** It is sent once, at login, in the body of the request; the browser then keeps a random session token, never the password. The server stores only keyed hashes of the tokens and of the addresses that typed a wrong password. Changing the password in `config.php` ends every session.
- **Guessing.** After five wrong passwords in ten minutes from the same address, logins from that address are refused for the rest of the ten minutes (IPv6 addresses count by /64 network; behind the hosting's proxy, visitors are told apart by the address the proxy reports). After thirty wrong passwords from all addresses together, every login is refused in the same way: this stops bots that try from many addresses, and refused attempts cost the server almost nothing. Both limits are in `config.php`. A conductor who is already logged in keeps working in both cases. The price of the second limit: whoever keeps sending wrong passwords can keep new logins closed, so log in before the concert with *Remember on this computer*.
- **Default and empty password.** `changeme` is accepted only from the server's own computer and never through a proxy; an empty password is always refused.
- **Performers.** They need no password. What protects the timer from strangers is the opening by the conductor, plus, if set, the ensemble code: a light barrier, not a password, since it travels in the address and can be found by trying.
- **Pages.** No inline scripts: a Content-Security-Policy allows only the scripts of this folder, and the conductor's page refuses to run inside another site's frame.
- **Data.** Whatever the displays receive is checked by the server first: names without control characters and at most 60 characters, at most 99 countdowns per piece, lengths from 1 second to 999:59, colours as `#rrggbb`, start position within the piece. A damaged `data/state.json` is served cleaned.
- **Requests.** Bodies over 16 KB are refused; PHP warnings are never shown. A display that already has the current state receives only the clock, which keeps the traffic small.
- **HTTPS.** Required. `.htaccess` sends every `http://` request to `https://`, and `api.php` refuses anything that does not arrive over HTTPS, so password and session never travel unprotected, on nginx too. HTTPS that ends at the hosting's proxy is recognised through `X-Forwarded-Proto`. `FORCE_HTTPS` in `config.php` turns it off for a site with no HTTPS at all. Testing on the same computer (`localhost`) is exempt.
- **nginx.** `.htaccess` files are ignored. Add to the site configuration, with your folder name: `location ~ ^/relais/(data/|config\.php$|README\.md$) { deny all; }`.

## Files

| File | Content |
| :- | :- |
| `api.php` | server: current piece, start position, run instants, conductor's login and sessions, block after wrong passwords, ensemble code |
| `config.php` | password, ensemble code, limits, lead time of the commands |
| `director.html`, `director.js` | conductor's page: setlists, player, seek bar, settings, QR code |
| `index.html`, `display.js` | performers' display |
| `timer.js` | code shared by the two pages: seven-segment digits, title, seek bar, clock offset, what to show at each instant |
| `qrcode.js` | QR code generator by Kazuhiko Arase (qrcode-generator 2.0.4, MIT licence), used unchanged by the conductor's page |
| `.htaccess`, `data/.htaccess`, `data/index.html` | protections: no indexing, security headers, `config.php` and `data/` not readable from the web |

## Development

```sh
cd web && php -S 127.0.0.1:8096
```

Conductor on `http://127.0.0.1:8096/director.html` (the default password `changeme` is accepted only from the same computer), displays on `http://127.0.0.1:8096/`. The built-in PHP server ignores `.htaccess`.

The approach (polling, clock offset, commands with a lead time, password protection) comes from Élan's web version and from KAIROGRAPHIA, Alessandro Ciccarelli's web app for conducting improvisation.
