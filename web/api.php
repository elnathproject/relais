<?php
/*
 * Relais for ensembles: one piece of sequential countdowns, controlled by a conductor and
 * shown on every display.
 * Copyright (c) 2026 Elnath Project (Alessandro Ciccarelli)
 * Released under the MIT License: see the LICENSE file.
 *
 * The state lives in data/state.json; the pages poll it every 0.6 s, and receive the whole
 * state only when it has changed (rev). The server never sends the remaining seconds: it sends
 * the piece (lengths and colours of its countdowns), the start position and the instants at which
 * the run started and paused. Every display computes the current countdown from its own clock,
 * corrected by the offset from the server's clock, so all displays change countdown together.
 * The end of a piece is computed the same way: the server also sends the next piece of the
 * setlist, and the displays show its title as soon as the current piece ends.
 */
ini_set('display_errors', '0'); // PHP warnings would reveal the paths of the server
require __DIR__ . '/config.php';
defined('DIRECTOR_PASSWORD') || define('DIRECTOR_PASSWORD', '');
defined('SYNC_DELAY_MS') || define('SYNC_DELAY_MS', 1000);
defined('ENSEMBLE_CODE') || define('ENSEMBLE_CODE', '');
defined('FORCE_HTTPS') || define('FORCE_HTTPS', true);
defined('LOGIN_MAX_FAILS') || define('LOGIN_MAX_FAILS', 5);
defined('LOGIN_MAX_FAILS_ALL') || define('LOGIN_MAX_FAILS_ALL', 30);
defined('CLOSE_AFTER_MINUTES') || define('CLOSE_AFTER_MINUTES', 120);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cross-Origin-Resource-Policy: same-origin');

const AUTH_WINDOW = 600;    // window and length of the blocks for wrong passwords, in seconds
const AUTH_MAX_IPS = 2000;  // addresses remembered for wrong passwords
const TOKEN_HOURS = 12;     // length of a conductor's session
const TOKEN_DAYS = 30;      // the same, with "remember on this computer"
const MAX_TOKENS = 20;      // conductor's sessions open at the same time
const ONLINE_WINDOW = 6;    // seconds without polling after which a display counts as gone
const MAX_DISPLAYS = 200;   // displays remembered at the same time
const MAX_SEG_S = 999 * 60 + 59; // longest countdown, in seconds
const MAX_SEGS = 99;         // countdowns in a piece
const MAX_NAME = 60;         // characters of a name
const MAX_BODY = 16384;     // bytes accepted in a request: two pieces of 99 countdowns stay well below
const AUTH_FILE = __DIR__ . '/data/auth.json';

function out($d) { echo json_encode($d, JSON_UNESCAPED_UNICODE); }
function now_ms() { return (int) round(microtime(true) * 1000); }
function str($v, $max = 200) { return is_string($v) ? substr($v, 0, $max) : ''; } // anything but a string is ignored
function color_or_null($c) { return is_string($c) && preg_match('/^#[0-9a-fA-F]{6}$/', $c) ? strtolower($c) : null; }
function int_in($v, $min, $max) {
  $n = is_numeric($v) ? (float)$v : 0.0;
  if (!is_finite($n)) $n = 0.0;
  return (int) max($min, min($max, round($n)));
}
// a name: no control characters, at most MAX_NAME characters (mbstring when available, so letters with accents stay whole)
function name_in($v) {
  if (!is_string($v)) return '';
  $v = preg_replace('/[\x00-\x1f\x7f]/u', '', $v) ?? '';
  return function_exists('mb_substr') ? mb_substr($v, 0, MAX_NAME) : substr($v, 0, MAX_NAME);
}
// a piece as the pages may send it: a name and 1-99 countdowns, each with a length and two colours.
// Anything else is dropped; a piece without valid countdowns is no piece (null).
function piece_in($w) {
  if (!is_array($w) || !is_array($w['segments'] ?? null)) return null;
  $segs = [];
  foreach (array_slice($w['segments'], 0, MAX_SEGS) as $g) {
    if (!is_array($g)) continue;
    $bg = color_or_null($g['bg'] ?? null); $fg = color_or_null($g['fg'] ?? null);
    if ($bg === null || $fg === null || !is_numeric($g['s'] ?? null)) continue;
    $segs[] = ['s' => int_in($g['s'], 1, MAX_SEG_S), 'bg' => $bg, 'fg' => $fg];
  }
  return $segs ? ['name' => name_in($w['name'] ?? ''), 'segments' => $segs] : null;
}
function piece_ms($w) { $t = 0; foreach ($w['segments'] as $g) $t += $g['s']; return $t * 1000; }
// the same computer as the server, and not through a proxy (which would make every visitor look local)
function is_local() {
  foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_FORWARDED', 'HTTP_X_REAL_IP', 'HTTP_CF_CONNECTING_IP'] as $h) if (!empty($_SERVER[$h])) return false;
  return in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
}
// HTTPS, also when it ends at the hosting's proxy (X-Forwarded-Proto, as on Tophost)
function is_https() {
  return (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') || (string)($_SERVER['SERVER_PORT'] ?? '') === '443'
      || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}
function password_usable() { return DIRECTOR_PASSWORD !== '' && (DIRECTOR_PASSWORD !== 'changeme' || is_local()); }

// --- HTTPS only: over plain HTTP nothing is answered, so no password or token is ever accepted in clear ---
if (FORCE_HTTPS && !is_https() && !is_local()) { http_response_code(403); exit('{"error":"https"}'); }

// --- request: a small JSON object, nothing else ---
$rawIn = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if (strlen($rawIn) > MAX_BODY) { http_response_code(413); exit('{"error":"too large"}'); }
$in = json_decode($rawIn !== '' ? $rawIn : '{}', true, 6); // depth 6: request, piece, segments, countdown, value
if (!is_array($in)) $in = [];
$a = str($_GET['a'] ?? ($in['a'] ?? ''), 20);

// --- conductor's access: wrong passwords per address, and open sessions ---
// Addresses and session tokens are stored only as keyed hashes: reading the file reveals neither.
function ip_norm($ip) {
  $bin = @inet_pton(trim($ip));
  // IPv6: a visitor owns a whole /64 and could change address at every attempt
  if ($bin !== false && strlen($bin) === 16 && substr($bin, 0, 12) !== "\0\0\0\0\0\0\0\0\0\0\xff\xff") return bin2hex(substr($bin, 0, 8));
  return substr(trim($ip), 0, 60);
}
function client_key() {
  // behind the hosting's proxy everybody arrives from the same address: the last address added by the proxy tells them apart
  $fwd = explode(',', (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
  return hash_hmac('sha256', ip_norm($_SERVER['REMOTE_ADDR'] ?? '?') . '|' . ip_norm((string)end($fwd)), 'ip' . DIRECTOR_PASSWORD);
}
// changing the password in config.php closes every open session
function token_hash($t) { return hash_hmac('sha256', $t, 'token' . DIRECTOR_PASSWORD); }
function auth_load() {
  $A = json_decode(@file_get_contents(AUTH_FILE) ?: '{}', true);
  $A = ['fails' => is_array($A['fails'] ?? null) ? $A['fails'] : [], 'tokens' => is_array($A['tokens'] ?? null) ? $A['tokens'] : [],
        'all' => is_array($A['all'] ?? null) ? $A['all'] : []];
  $now = time();
  // wrong passwords from every address together, in the current window
  $A['all'] = ['n' => (int)($A['all']['n'] ?? 0), 't' => (int)($A['all']['t'] ?? 0)];
  if ($now - $A['all']['t'] > AUTH_WINDOW) $A['all'] = ['n' => 0, 't' => $now];
  foreach ($A['fails'] as $k => $v) if (!is_array($v) || $now - (int)($v['t'] ?? 0) > AUTH_WINDOW) unset($A['fails'][$k]);
  foreach ($A['tokens'] as $k => $exp) if ((int)$exp < $now) unset($A['tokens'][$k]);
  return $A;
}
function auth_save($A) { @file_put_contents(AUTH_FILE, json_encode($A), LOCK_EX); }
// minutes of block for this request, or 0: too many wrong passwords from this address, or from all addresses together
function login_blocked($A) {
  $now = time(); $f = $A['fails'][client_key()] ?? null;
  if ($f && (int)($f['n'] ?? 0) >= max(1, (int)LOGIN_MAX_FAILS)) return max(1, (int) ceil(((int)$f['t'] + AUTH_WINDOW - $now) / 60));
  if ((int)LOGIN_MAX_FAILS_ALL > 0 && $A['all']['n'] >= (int)LOGIN_MAX_FAILS_ALL) return max(1, (int) ceil(($A['all']['t'] + AUTH_WINDOW - $now) / 60));
  return 0;
}
// a blocked login is answered at once, before the timer's file is even opened: a flood of attempts stays cheap
if ($a === 'login' && ($min = login_blocked(auth_load()))) { http_response_code(429); exit(json_encode(['type' => 'blocked', 'minutes' => $min])); }

// --- state, with exclusive lock: one request at a time changes it ---
$file = __DIR__ . '/data/state.json';
$fh = fopen($file, 'c+');
if (!$fh) { http_response_code(500); exit('{"error":"data/ is not writable"}'); }
flock($fh, LOCK_EX);
$raw = stream_get_contents($fh);
$S = $raw ? json_decode($raw, true) : null;
$dirty = false;
if (!is_array($S)) { $S = []; $dirty = true; }
$DEFAULTS = [
  'rev' => 0,           // grows at every command: displays redraw when it changes
  'mode' => 'idle',     // idle (no piece loaded), title (title of the piece, waiting), run (started)
  'piece' => null,       // the piece: name and countdowns
  'next' => null,       // the next piece of the setlist, shown at the end of this one (null: none)
  'list' => false,      // played as part of a setlist (true) or on its own (false)
  'setlist' => '',           // name of the setlist
  'pos' => 0,           // position of the piece in the setlist, from 0
  'count' => 1,         // pieces in the setlist
  'seek' => 0,          // start position in the piece, ms (seek bar of the title)
  'acc' => 0,           // ms elapsed in the runs that are over
  'since' => null,      // server instant at which the current run starts (null: stopped)
  'until' => null,      // server instant at which the current run is paused (null: running)
  'vibrate' => false,   // vibration at each change on the displays
  'displays' => [],     // anonymous id => last poll (unix seconds)
  'conductors' => [],   // session id => last contact (unix seconds): the timer is open while one is recent
];
$S += $DEFAULTS;
// the file is trusted only as far as its types: whatever it holds, the pages receive clean values
$S['rev'] = (int)$S['rev'];
$S['piece'] = piece_in($S['piece']);
$S['next'] = piece_in($S['next']);
$S['mode'] = $S['piece'] === null ? 'idle' : (in_array($S['mode'], ['title', 'run'], true) ? $S['mode'] : 'title');
$S['list'] = (bool)$S['list'];
$S['setlist'] = name_in($S['setlist']);
$S['count'] = int_in($S['count'], 1, 999);
$S['pos'] = int_in($S['pos'], 0, $S['count'] - 1);
$S['seek'] = $S['piece'] ? int_in($S['seek'], 0, piece_ms($S['piece']) - 1000) : 0;
$S['acc'] = max(0, (int)$S['acc']);
$S['since'] = $S['mode'] === 'run' && is_numeric($S['since']) ? (int)$S['since'] : null;
$S['until'] = $S['since'] !== null && is_numeric($S['until']) ? (int)$S['until'] : null;
$S['vibrate'] = (bool)$S['vibrate'];
if (!is_array($S['displays'])) $S['displays'] = [];
if (!is_array($S['conductors'])) $S['conductors'] = [];
$closeAfter = max(1, (int)CLOSE_AFTER_MINUTES) * 60;
foreach ($S['conductors'] as $k => $seen) if (time() - (int)$seen > $closeAfter) { unset($S['conductors'][$k]); $dirty = true; }
// The performers see the timer only while it is open: from the conductor's login until Log out,
// or until CLOSE_AFTER_MINUTES after the conductor's page was last connected.
$open = count($S['conductors']) > 0;
function conductor_seen(&$S, $token, &$dirty) {
  $cid = substr(token_hash($token), 0, 16); $t = time();
  if (($S['conductors'][$cid] ?? 0) !== $t) { $S['conductors'][$cid] = $t; $dirty = true; } // written at most once a second
}
$delay = max(0, min(5000, (int)SYNC_DELAY_MS));

// what every page needs to draw the timer
function timer($S) {
  $t = ['rev' => $S['rev'], 'now' => now_ms()];
  foreach (['mode', 'piece', 'next', 'list', 'setlist', 'pos', 'count', 'seek', 'acc', 'since', 'until', 'vibrate'] as $k) $t[$k] = $S[$k];
  return $t;
}
function online($S) {
  $t = time(); $n = 0;
  foreach ($S['displays'] as $seen) if ($t - (int)$seen <= ONLINE_WINDOW) $n++;
  return $n;
}
// problems the conductor should know about; never details of the files
function warnings() {
  $w = []; $base = __DIR__;
  if (!is_writable("$base/data")) $w[] = 'The data folder is not writable: the server cannot save the timer. Try permissions 755, or 775.';
  if (strlen(DIRECTOR_PASSWORD) < 8) $w[] = 'The conductor\'s password is shorter than 8 characters: choose a longer one in config.php.';
  $loose = [];
  foreach (['.', 'data', 'api.php', 'config.php', 'index.html', 'director.html', 'timer.js', 'qrcode.js', 'display.js', 'director.js', '.htaccess', 'data/.htaccess'] as $f) {
    $p = @fileperms("$base/$f");
    if ($p !== false && ($p & 0002)) $loose[] = $f === '.' ? 'the main folder' : $f;
  }
  if ($loose) $w[] = 'Permissions too wide (writable by anyone on the server, usually 777 or 666): ' . implode(', ', $loose) . '. Set 755 for folders and 644 for files.';
  foreach (['.htaccess', 'data/.htaccess', 'data/index.html'] as $f)
    if (!file_exists("$base/$f")) $w[] = "The protection file $f is missing: upload it again (it is a hidden file, some FTP programs skip it).";
  return $w;
}
function state_for_director($S) {
  return ['type' => 'state', 'online' => online($S), 'codeRequired' => ENSEMBLE_CODE !== '', 'code' => ENSEMBLE_CODE,
          'closeAfter' => max(1, (int)CLOSE_AFTER_MINUTES), 'warnings' => warnings()] + timer($S);
}

switch ($a) {
  // ================= displays =================
  case 'poll': {
    // closed: nothing is told and nothing is written, whatever the code
    if (!$open) { out(['closed' => true, 'now' => now_ms()]); break; }
    if (ENSEMBLE_CODE !== '' && !hash_equals(ENSEMBLE_CODE, trim(str($_GET['code'] ?? '')))) {
      http_response_code(403); out(['error' => 'code']); break;
    }
    $id = substr(preg_replace('/[^a-zA-Z0-9-]/', '', str($_GET['id'] ?? '')), 0, 64);
    if ($id !== '') {
      $t = time();
      // list full: make room by forgetting the displays that have stopped polling
      if (!isset($S['displays'][$id]) && count($S['displays']) >= MAX_DISPLAYS)
        foreach ($S['displays'] as $k => $seen) if ($t - (int)$seen > 2 * ONLINE_WINDOW) { unset($S['displays'][$k]); $dirty = true; }
      // "seen" is written at most once a second, so the file is not rewritten at every poll
      if (($S['displays'][$id] ?? 0) !== $t && (isset($S['displays'][$id]) || count($S['displays']) < MAX_DISPLAYS)) {
        $S['displays'][$id] = $t; $dirty = true;
      }
      if (mt_rand(0, 50) === 0) // now and then, forget displays not seen for an hour
        foreach ($S['displays'] as $k => $seen) if ($t - (int)$seen > 3600) { unset($S['displays'][$k]); $dirty = true; }
    }
    // unchanged since the display's last poll: the clock only (keeps the traffic small)
    if (isset($_GET['rev']) && (string)$_GET['rev'] === (string)$S['rev']) { out(['rev' => $S['rev'], 'now' => now_ms(), 'same' => true]); break; }
    out(timer($S));
    break;
  }

  // ================= conductor =================
  case 'login': { // password → session token; the password is never stored in the browser
    $A = auth_load(); $ip = client_key();
    if ($min = login_blocked($A)) { http_response_code(429); out(['type' => 'blocked', 'minutes' => $min]); break; }
    if (DIRECTOR_PASSWORD === '') { http_response_code(403); out(['type' => 'no-password']); break; }
    // the password travels only in the request body, never in the address
    if (!hash_equals(hash('sha256', DIRECTOR_PASSWORD), hash('sha256', str($in['key'] ?? '', 500)))) {
      $A['fails'][$ip] = ['n' => ($A['fails'][$ip]['n'] ?? 0) + 1, 't' => time()];
      $A['all']['n']++;
      if (count($A['fails']) > AUTH_MAX_IPS) $A['fails'] = array_slice($A['fails'], -AUTH_MAX_IPS, null, true);
      auth_save($A);
      http_response_code(403); out(['type' => 'denied']); break;
    }
    if (!password_usable()) { http_response_code(403); out(['type' => 'default-password']); break; }
    unset($A['fails'][$ip]);
    $token = bin2hex(random_bytes(32));
    $A['tokens'][token_hash($token)] = time() + (!empty($in['remember']) ? TOKEN_DAYS * 86400 : TOKEN_HOURS * 3600);
    if (count($A['tokens']) > MAX_TOKENS) { asort($A['tokens']); $A['tokens'] = array_slice($A['tokens'], -MAX_TOKENS, null, true); }
    auth_save($A);
    conductor_seen($S, $token, $dirty); // the login opens the timer for the performers
    out(['token' => $token] + state_for_director($S));
    break;
  }
  default: { // every other action needs an open session
    $A = auth_load(); $token = str($in['token'] ?? '', 128);
    if ($token === '' || !isset($A['tokens'][token_hash($token)]) || !password_usable()) { http_response_code(403); out(['type' => 'denied']); break; }
    if ($a !== 'logout') conductor_seen($S, $token, $dirty);
    $at = now_ms() + $delay; // instant at which a command takes effect, the same for every display
    $running = $S['mode'] === 'run' && $S['since'] !== null && $S['until'] === null;
    switch ($a) {
      case 'state': break;
      case 'logout': { // closes the timer too, unless another conductor is at piece right now
        unset($A['tokens'][token_hash($token)]); auth_save($A);
        unset($S['conductors'][substr(token_hash($token), 0, 16)]);
        $others = false;
        foreach ($S['conductors'] as $seen) if (time() - (int)$seen <= 5) $others = true;
        if (!$others) $S['conductors'] = [];
        $dirty = true; $token = '';
        break;
      }
      case 'load': { // a piece becomes the current one, on its title; optionally started at once
        $w = piece_in($in['piece'] ?? null);
        if ($w === null) break;
        $S['piece'] = $w; $S['next'] = !empty($in['list']) ? piece_in($in['next'] ?? null) : null;
        $S['list'] = !empty($in['list']); $S['setlist'] = name_in($in['setlist'] ?? '');
        $S['count'] = int_in($in['count'] ?? 1, 1, 999); $S['pos'] = int_in($in['pos'] ?? 0, 0, $S['count'] - 1);
        $S['seek'] = int_in(round(((float)($in['seek'] ?? 0)) / 1000) * 1000, 0, piece_ms($w) - 1000);
        $S['acc'] = 0; $S['since'] = null; $S['until'] = null; $S['mode'] = 'title';
        if (!empty($in['start'])) { $S['mode'] = 'run'; $S['since'] = $at; }
        $S['rev']++; $dirty = true;
        break;
      }
      case 'seek': // start position, on the title only
        if ($S['mode'] === 'title') {
          $S['seek'] = int_in(round(((float)($in['ms'] ?? 0)) / 1000) * 1000, 0, piece_ms($S['piece']) - 1000);
          $S['rev']++; $dirty = true;
        }
        break;
      case 'start': // from the title, at the start position
        if ($S['mode'] === 'title') {
          $S['mode'] = 'run'; $S['acc'] = 0; $S['since'] = $at; $S['until'] = null; $S['rev']++; $dirty = true;
        }
        break;
      case 'pause':
        if ($running) { $S['until'] = max($at, $S['since']); $S['rev']++; $dirty = true; }
        break;
      case 'resume':
        if ($S['since'] !== null && $S['until'] !== null) {
          $S['acc'] += max(0, $S['until'] - $S['since']);
          $S['since'] = max($at, $S['until']); $S['until'] = null; $S['rev']++; $dirty = true;
        }
        break;
      case 'reset': // back to the title of the same piece, at the same start position
        if ($S['piece'] !== null) {
          $S['mode'] = 'title'; $S['acc'] = 0; $S['since'] = null; $S['until'] = null; $S['rev']++; $dirty = true;
        }
        break;
      case 'clear': // no piece: the displays wait for the conductor
        $S['mode'] = 'idle'; $S['piece'] = null; $S['next'] = null; $S['seek'] = 0;
        $S['acc'] = 0; $S['since'] = null; $S['until'] = null; $S['rev']++; $dirty = true;
        break;
      case 'look': // vibration at each change, at any moment
        if (isset($in['vibrate'])) { $S['vibrate'] = (bool)$in['vibrate']; $S['rev']++; $dirty = true; }
        break;
    }
    out(state_for_director($S));
  }
}

if ($dirty) { ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($S, JSON_UNESCAPED_UNICODE)); fflush($fh); }
flock($fh, LOCK_UN); fclose($fh);
