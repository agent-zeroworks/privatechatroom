// Minx's Chatroom — frontend
// Served as a single HTML page; the client routes between screens:
//   /             -> blank main screen (v0.10.0): the only door is the tiny
//                    blank square button bottom-right → private rooms
//   /private      -> private room landing (create / join by code, tucked aside)
//   /room/<code>  -> private room join
//   /auth/verify  -> magic-link landing (sign-in screen; dev shows link inline)
//   views         -> html[data-view] re-skins the app: 'user' (normal UI,
//                    locked for humans) or 'agent' (agent-optimized, with an
//                    always-on switcher for agent accounts)
//
// NOTE: String.raw keeps backslashes intact, so regexes inside this HTML
// survive verbatim. Backticks and ${ are the only escapes needed — the
// client script uses neither. scripts/check-frontend.mjs verifies the
// extracted client script parses, so a broken page can never ship again.

export const FRONTEND = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chatroom</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  /* Design tokens — the normal (human) theme is the default. The agent
     view overrides these on html[data-view="agent"]; every color below
     reads through a variable, so a view switch re-skins the whole app
     in one shot. */
  :root {
    --bg: #f6f6f4;
    --panel: #ffffff;
    --panel-hover: #f0f0f0;
    --fg: #333333;
    --sub: #777777;
    --name: #555555;
    --faint: #999999;
    --border: #cccccc;
    --border-soft: #e0e0e0;
    --border-header: #dddddd;
    --accent: #4a6fa5;
    --accent-hover: #3f5f8f;
    --accent-soft: #eef2f7;
    --accent-fg: #ffffff;
    --me-bg: #eaf1f8;
    --me-border: #bcd0e4;
    --me-time: #7a93ad;
    --danger: #b3261e;
    --danger-soft: #fdecea;
  }

  /* v0.10.2 — page scroll locked. Panels (version history, chat messages)
     scroll on their own; the page itself never moves on a phone. */
  html, body { height: 100%; overflow: hidden; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--fg);
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .screen {
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    height: 100dvh; /* v0.10.2 — real phone viewport, no URL-bar overflow */
    gap: 12px;
    padding: 20px;
    text-align: center;
  }
  .screen.on { display: flex; }

  .screen h1 { font-size: 1.5rem; font-weight: 600; color: var(--fg); }
  .screen p { color: var(--sub); max-width: 380px; line-height: 1.5; font-size: 0.9rem; }
  .screen .or { color: var(--faint); font-size: 0.85rem; }
  .pref-line { color: var(--sub); font-size: 0.85rem; display: flex; align-items: center; gap: 6px; user-select: none; }
  .pref-line input { accent-color: var(--accent); margin: 0; }

  .screen input {
    padding: 10px 12px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--fg);
    font-size: 0.95rem;
    width: 260px;
    outline: none;
  }
  .screen input:focus { border-color: var(--accent); }
  .screen input.code-input {
    width: 200px;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .screen button {
    padding: 10px 24px;
    border-radius: 4px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-fg);
    font-size: 0.95rem;
    cursor: pointer;
  }
  .screen button:hover { background: var(--accent-hover); }
  .screen button:disabled { opacity: 0.5; cursor: not-allowed; }
  .screen button.ghost {
    background: var(--panel);
    color: var(--accent);
  }
  .screen button.ghost:hover { background: var(--accent-soft); }

  .row { display: flex; gap: 8px; align-items: center; }

  .foot-link {
    margin-top: 8px;
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: 0.85rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .foot-link:hover { color: var(--accent-hover); }

  .error {
    color: var(--danger);
    font-size: 0.8rem;
    min-height: 1.1em;
  }

  [hidden] { display: none !important; }

  /* Magic-link sign-in — the dev build shows the link inline (no email yet) */
  #auth-dev-box {
    background: #fff8e1;
    border: 1px dashed #b26a00;
    border-radius: 4px;
    padding: 10px 14px;
    max-width: 380px;
    font-size: 0.8rem;
    color: #5a3a00;
    word-break: break-all;
  }
  #auth-dev-box p { margin: 4px 0; }
  #auth-dev-box a { color: #4a6fa5; }
  #auth-dev-box b {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 1.2rem;
    letter-spacing: 3px;
    color: #333;
  }
  #auth-status {
    font-size: 0.8rem;
    color: #777;
    max-width: 380px;
    word-break: break-word;
  }

  /* Test build: tag-only test buttons (dev only, v0.8.3). Pure tag
     toggles — they add the AGENT tag to YOUR messages and nothing else
     changes: no account, no name swap, no redirect. Works in the public
     room and private rooms. */
  .tag-test-box {
    background: #eef6ee;
    border: 1px dashed #2e7d32;
    border-radius: 4px;
    padding: 10px 14px;
    max-width: 380px;
    font-size: 0.8rem;
    color: #1b4d1f;
    text-align: left;
  }
  .tag-test-box .dt-title { font-weight: 700; margin: 0 0 4px; }
  .tag-test-box p { margin: 4px 0; }
  .tag-test-box .dt-row { display: flex; gap: 8px; margin: 10px 0; }
  .tag-test-box button {
    flex: 1;
    background: #2e7d32;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .tag-test-box button:hover { background: #1b5e20; }
  .tag-test-box button.active {
    background: #1b5e20;
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px #2e7d32;
    font-weight: 700;
  }
  .tag-test-box .dt-note { margin: 0; color: #3d6b40; }
  /* Compact in-chat toggle for the same tag (dev only) */
  #tag-header-btn.active { background: #2e7d32; border-color: #2e7d32; color: #fff; }

  /* Agent senders get a small tag so role testing is visible */
  .msg .agent-tag {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #2f2f2f;
    color: #f2ead8;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    vertical-align: 1px;
  }

  #room-code-box {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 6px 12px;
    border-radius: 4px;
    color: var(--sub);
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  #room-code-box b {
    color: var(--fg);
    letter-spacing: 2px;
    font-size: 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  #room-code-box button {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--accent);
    padding: 3px 10px;
    font-size: 0.75rem;
    border-radius: 3px;
    cursor: pointer;
  }
  #room-code-box button:hover { background: var(--accent-soft); }

  #chat-screen { display: none; flex-direction: column; height: 100vh; height: 100dvh; }
  #chat-screen.on { display: flex; }

  #header {
    padding: 10px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--border-header);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  #header h2 { font-size: 1rem; font-weight: 600; color: var(--fg); }
  #header span { font-size: 0.8rem; color: var(--sub); }
  #header .head-actions { display: flex; gap: 8px; align-items: center; }
  #header button {
    padding: 6px 12px;
    font-size: 0.8rem;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--name);
    border-radius: 4px;
    cursor: pointer;
  }
  #header button:hover { background: var(--panel-hover); }
  #header button.leave:hover { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }
  #header button.close:hover { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }

  #status { font-size: 0.8rem; padding: 3px 10px; border-radius: 3px; border: 1px solid #ccc; }
  #status.connected { color: #2e7d32; border-color: #a5d6a7; background: #e8f5e9; }
  #status.disconnected { color: #c62828; border-color: #ef9a9a; background: #fdecea; }
  #status.connecting { color: #b26a00; border-color: #ffcc80; background: #fff3e0; }

  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .msg {
    padding: 8px 12px;
    border-radius: 4px;
    border: 1px solid var(--border-soft);
    background: var(--panel);
    max-width: 75%;
    word-wrap: break-word;
    line-height: 1.4;
    font-size: 0.92rem;
  }
  .msg .name { font-weight: 600; font-size: 0.78rem; margin-bottom: 2px; color: var(--name); }
  .msg .time { font-size: 0.7rem; color: var(--faint); margin-top: 4px; }
  .msg.me {
    align-self: flex-end;
    background: var(--me-bg);
    border-color: var(--me-border);
  }
  .msg.me .time { color: var(--me-time); }
  .msg.other { align-self: flex-start; }
  .msg.system {
    align-self: center;
    background: transparent;
    border: none;
    color: var(--faint);
    font-size: 0.8rem;
  }
  .msg .del {
    margin-left: 8px;
    background: none;
    border: 1px solid var(--border);
    color: var(--sub);
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 0.7rem;
    cursor: pointer;
  }
  .msg .del:hover { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }

  /* v0.11.0 — photos in chat. Thumbnail inside the bubble; tap opens full size. */
  .msg .photo {
    display: block;
    max-width: 220px;
    max-height: 220px;
    border-radius: 6px;
    margin-top: 6px;
    border: 1px solid var(--border);
    cursor: zoom-in;
    object-fit: cover;
  }

  #img-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 1rem;
    cursor: pointer;
    color: var(--sub);
    flex-shrink: 0;
  }
  #img-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  #img-btn:disabled { opacity: 0.4; cursor: default; }

  #input-area {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    background: var(--panel);
    border-top: 1px solid var(--border-header);
  }
  #input-area input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--fg);
    font-size: 0.95rem;
    outline: none;
  }
  #input-area input:focus { border-color: var(--accent); }
  #input-area button {
    padding: 10px 20px;
    border-radius: 4px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 500;
    cursor: pointer;
  }
  #input-area button:hover { background: var(--accent-hover); }
  #input-area button:disabled { opacity: 0.4; cursor: not-allowed; }

  #online-count { font-size: 0.8rem; color: var(--sub); }

  /* Heartline version badge — subtle, bottom-LEFT, tap for history (v0.10.0) */
  #version-box {
    position: fixed;
    left: 10px;
    bottom: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.68rem;
    color: var(--faint);
    cursor: pointer;
    user-select: none;
    z-index: 50;
  }
  #version-box:hover { color: var(--sub); }
  /* v0.10.1 — compact changelog window: ~4 rows visible, scrollable */
  #version-history {
    position: absolute;
    left: 0;
    bottom: 20px;
    background: var(--panel);
    border: 1px solid var(--border-header);
    padding: 8px 10px;
    min-width: 230px;
    max-width: 300px;
    max-height: 150px;
    overflow-y: auto;
    overscroll-behavior: contain;
    text-align: left;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.75rem;
    color: var(--name);
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  #version-history[hidden] { display: none; }
  #version-history h3 {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--panel-hover);
    padding-bottom: 4px;
  }
  #version-history .vrow { padding: 4px 0; border-bottom: 1px solid var(--border-soft); }
  #version-history .vrow:last-child { border-bottom: none; }
  #version-history .vrow b {
    color: var(--fg);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-weight: 600;
    font-size: 0.7rem;
  }
  #version-history .vrow span {
    display: block;
    color: var(--sub);
    font-size: 0.7rem;
    line-height: 1.35;
    margin-top: 1px;
  }

  /* Secret door (v0.10.0): tiny blank square, bottom-right. Opens the
     private rooms section. Blank on purpose — the main screen is blank,
     and this is the only way in. */
  #secret-btn {
    position: fixed;
    right: 12px;
    bottom: 8px;
    width: 22px;
    height: 22px;
    border: 1px solid var(--faint);
    border-radius: 3px;
    background: transparent;
    padding: 0;
    cursor: pointer;
    z-index: 50;
  }
  #secret-btn:hover { border-color: var(--sub); background: var(--panel-hover); }
  #secret-btn:active { transform: scale(0.94); }

  /* Test build banner — loud, fixed to the top. Injected on the dev worker. */
  #test-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: repeating-linear-gradient(45deg, #ffb020, #ffb020 14px, #ffc94d 14px, #ffc94d 28px);
    color: #5a3a00;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 5px 10px;
    letter-spacing: 0.5px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  #test-banner .tb-mark {
    background: #5a3a00;
    color: #ffd98a;
    padding: 1px 8px;
    border-radius: 3px;
  }
  #test-banner .tb-note {
    font-weight: 400;
    opacity: 0.75;
  }
  /* Coming-soon banner — the official build's "not ready yet" sign (v0.8.0). */
  #soon-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: repeating-linear-gradient(45deg, #e8a87c, #e8a87c 14px, #f4c6a3 14px, #f4c6a3 28px);
    color: #4a2c16;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 5px 10px;
    letter-spacing: 0.5px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  #soon-banner .sb-mark {
    background: #4a2c16;
    color: #ffd9b8;
    padding: 1px 8px;
    border-radius: 3px;
  }
  #soon-banner .sb-note {
    font-weight: 400;
    opacity: 0.8;
  }
  /* v0.10.2 — banner clearance via padding (inside the viewport-sized
     screen) instead of margin, so the page never grows past the viewport
     and can't scroll on phones */
  body.test-build .screen, body.test-build #chat-screen { padding-top: 34px; }
  body.soon-build .screen, body.soon-build #chat-screen { padding-top: 34px; }

  /* ------------------------------------------------------------------
     AGENT VIEW — the second design (v0.6.0)
     html[data-view="agent"] re-skins the whole app for agent readers:
     dark, high contrast, denser info, bigger type. The switcher lives
     in JS; human accounts are locked to the normal design and never
     see it. Agent accounts default here and keep an always-on switch.
     ------------------------------------------------------------------ */
  html[data-view="agent"] {
    --bg: #0b0f14;
    --panel: #12181f;
    --panel-hover: #1b2430;
    --fg: #e8eef4;
    --sub: #9aa7b4;
    --name: #c9d6e2;
    --faint: #6e7b88;
    --border: #2f3d4b;
    --border-soft: #23303d;
    --border-header: #1e2933;
    --accent: #ffb224;
    --accent-hover: #ffc75c;
    --accent-soft: #2b2313;
    --accent-fg: #1a1206;
    --me-bg: #1b2531;
    --me-border: #33455c;
    --me-time: #8fa3b8;
    --danger: #ff6b5e;
    --danger-soft: #3a1d1a;
    font-size: 17px;  /* bigger base type: faster reading at higher contrast */
  }
  html[data-view="agent"] .screen p { max-width: 520px; }
  html[data-view="agent"] .screen input { font-size: 1rem; }
  html[data-view="agent"] .screen button { font-weight: 600; }
  html[data-view="agent"] #messages { gap: 4px; padding: 12px 14px; }
  html[data-view="agent"] .msg { max-width: 88%; position: relative; }
  html[data-view="agent"] .msg .name { font-size: 0.82rem; letter-spacing: 0.3px; padding-right: 64px; }
  html[data-view="agent"] .msg .time {
    position: absolute;
    top: 8px;
    right: 10px;
    margin-top: 0;
    font-size: 0.66rem;
  }
  html[data-view="agent"] .msg.me { border-left: 3px solid var(--accent); }
  html[data-view="agent"] .msg.other { border-left: 3px solid var(--border); }
  html[data-view="agent"] .msg.system {
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 0.72rem;
  }
  html[data-view="agent"] .msg .agent-tag {
    background: var(--accent);
    color: var(--accent-fg);
  }
  html[data-view="agent"] #header h2 {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 1px;
  }
  html[data-view="agent"] #auth-dev-box {
    background: #2b2313;
    border-color: var(--accent);
    color: #f0d9a8;
  }
  html[data-view="agent"] #auth-dev-box b { color: var(--accent); }
  html[data-view="agent"] #auth-dev-box a { color: var(--accent); }
  html[data-view="agent"] .tag-test-box { background: #14231a; color: #b5e3c0; }

  /* ---- view switcher (agent accounts only; on screen at all times) ---- */
  #view-toggle {
    position: fixed;
    right: 10px;
    bottom: 30px;
    z-index: 60;
    display: none;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--fg);
    font-size: 0.78rem;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }
  #view-toggle:hover { border-color: var(--accent); }
  #view-toggle.visible { display: flex; }
  #view-toggle #view-chip {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 2px 6px;
    border-radius: 3px;
  }
  #view-toggle #view-chip.agent-on {
    background: var(--accent);
    color: var(--accent-fg);
    animation: view-chip-pulse 2s ease-in-out infinite;
  }
  #view-toggle #view-chip.user-on {
    border: 1px solid var(--border);
    color: var(--faint);
  }
  #view-toggle #view-action { font-weight: 600; }
  @keyframes view-chip-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 178, 36, 0.55); }
    50% { box-shadow: 0 0 0 6px rgba(255, 178, 36, 0); }
  }
  /* While an agent account is signed in, the switcher floats above the
     chat bar's right corner — reserve that space so nothing hides under it. */
  html[data-role="agent"] #input-area { padding-right: 210px; }
</style>
</head>
<body>

<!-- TEST BUILD ribbon — injected by the worker only on the dev lane. -->
__BANNER__

<!-- MAIN SCREEN (v0.10.0) — intentionally blank. The only door is the
     tiny blank square button bottom-right, which opens the private rooms
     section. Version badge sits bottom-left. The public room still exists
     at its code (CATCAFE8) for anyone who knows the way in. -->
<div id="public-join" class="screen"></div>

<!-- PRIVATE ROOMS -->
<div id="private-landing" class="screen">
  <h1>Private rooms</h1>
  <p>Create a room and share the code. Only signed-in people with the code can join.</p>
  <div id="auth-status"></div>
  <button id="create-btn">Create a private room</button>
  <div class="or">or</div>
  <div class="row">
    <input id="code-input" class="code-input" type="text" placeholder="Enter a code" maxlength="8" autocomplete="off">
    <button id="join-code-btn">Join</button>
  </div>
  <div class="error" id="code-error"></div>
  <button class="foot-link" id="signout-btn">Sign out</button>
</div>

<!-- PRIVATE ROOM JOIN -->
<div id="private-join" class="screen">
  <!-- Same tag toggle as the landing page — dev only. Lets a signed-in
       account carry the AGENT tag into a private room (v0.8.3). -->
  <div class="tag-test-box" hidden>
    <p class="dt-title">Tag test (dev only)</p>
    <p>Adds the AGENT tag to your messages. Nothing else changes: same name, same account, same room.</p>
    <div class="dt-row">
      <button class="tag-agent-btn">Test Agent</button>
      <button class="tag-clear-btn">No tag</button>
    </div>
    <p class="dt-note">Works in the public room AND private rooms. Everyone else sees the tag on your messages.</p>
  </div>
  <h1>Private room</h1>
  <div id="room-code-box">code <b id="room-code-display"></b><button id="copy-btn">Copy link</button></div>
  <p>Send the code or link to whoever you trust. This room is just for you.</p>
  <p id="join-identity"></p>
  <button id="private-join-btn">Join</button>
  <button class="foot-link" id="go-private-landing">Private rooms</button>
</div>

<!-- DORMANT ROOM — code past its week: locked, history kept, revival planned -->
<div id="dormant" class="screen">
  <h1>This room is asleep</h1>
  <div id="room-code-box">code <b id="dormant-code-display"></b></div>
  <p id="dormant-note">This room is asleep. Its messages are tucked away safely — with persistence, it wakes the next time someone with the code walks in.</p>
  <p id="dormant-expiry" class="or"></p>
  <p>Come back with the code — the room wakes up with everything intact.</p>
  <button class="ghost" id="dormant-private-btn">Private rooms</button>
</div>

<!-- SIGN IN — magic-link login. Gates private rooms. -->
<div id="signin" class="screen">
  <h1>Sign in</h1>
  <p>Private rooms are invite-only by code, and everyone inside is a signed-in account. One email, no passwords.</p>
  <input id="auth-email" type="email" placeholder="you@example.com" maxlength="120" autocomplete="email">
  <input id="auth-nick" type="text" placeholder="Nickname (optional)" maxlength="24" autocomplete="off">
  <label class="pref-line"><input type="checkbox" id="auth-notify" checked> email me when I miss messages in a room</label>
  <button id="auth-request-btn">Send magic link</button>
  <div id="auth-dev-box" hidden>
    <p>TEST BUILD — no email service yet, so here is your link and code:</p>
    <a id="auth-dev-link" href="#"></a>
    <p>Code: <b id="auth-dev-code"></b></p>
  </div>
  <div class="row" id="auth-code-row" hidden>
    <input id="auth-code" class="code-input" type="text" placeholder="6-digit code" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
    <button id="auth-verify-btn">Verify</button>
  </div>
  <div class="error" id="auth-error"></div>
</div>

<!-- CHAT -->
<div id="chat-screen">
  <div id="header">
    <div>
      <h2 id="room-title">Public room</h2>
      <span id="room-sub"></span>
    </div>
    <div class="head-actions">
      <span id="online-count">0 online</span>
      <button id="tag-header-btn" style="display:none" title="Dev only: toggle the AGENT tag on your messages">AGENT tag: off</button>
      <button id="copy-header-btn" style="display:none">Copy link</button>
      <button id="close-room-btn" class="close" style="display:none">Close room</button>
      <button id="leave-btn" class="leave" style="display:none">Leave</button>
      <div id="status" class="disconnected">Disconnected</div>
    </div>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <input id="msg-input" type="text" placeholder="Type a message" maxlength="500" autocomplete="off" disabled>
    <button id="img-btn" type="button" title="Send a photo" disabled>🖼</button>
    <button id="send-btn" disabled>Send</button>
    <input type="file" id="img-file" accept="image/jpeg,image/png,image/gif,image/webp" hidden>
  </div>
</div>

<!-- AGENT VIEW SWITCHER — agent accounts only; humans never see it (v0.6.0) -->
<button id="view-toggle" type="button">
  <span id="view-chip">AGENT VIEW</span>
  <span id="view-action">users' view</span>
</button>

<!-- HEARTLINE VERSION — SemVer, bottom-LEFT, tap for history (v0.10.0) -->
<div id="version-box">
  <span id="version-label">v0.11.0</span>
  <div id="version-history" hidden></div>
</div>

<!-- SECRET DOOR (v0.10.0) — tiny blank square, bottom-right. Opens the
     private rooms section. The main screen is blank; this is the door. -->
<button id="secret-btn" type="button" aria-label="Private rooms"></button>

<script>
const PUBLIC_ROOM = 'CATCAFE8'
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Heartline versioning (SemVer): vMAJOR.MINOR.PATCH[-STAGE]
// Below v1.0.0 until the project is officially ready. Bump MINOR for new
// features, PATCH for fixes/improvements. Tell the developer on every bump.
const VERSION = 'v0.11.0'
const ENV_TAG = '__APP_ENV_TAG__'
const IS_DEV = ENV_TAG === '-dev'
const VERSION_HISTORY = [
  { v: 'v0.11.0', note: 'Photos in private rooms: the 🖼 button uploads an image straight into the chat (tap it for full size). Door code is 4386 on both lanes now — one number for the whole club' },
  { v: 'v0.10.1', note: 'Version panel: newest entries at the bottom, compact window (~4 rows) that scrolls' },
  { v: 'v0.10.0', note: 'Blank main screen. Secret door: tiny blank square button bottom-right opens private rooms; version badge moved bottom-left. Real persistence: private room chats save forever and rooms only open to people with the code. No more wipe-on-close' },
  { v: 'v0.9.0', note: 'Away-notifications: digest emails when you miss messages in a room, one-tap link signs you back in; per-account on/off pref' },
  { v: 'v0.8.3', note: 'Test buttons are tag-only now: Test Agent just adds the AGENT tag to your messages — no account, no name swap, no redirect. Works in the public room AND private rooms; toggle from the landing page, the private room join screen, or the chat header. Dev only' },
  { v: 'v0.8.2', note: 'Test accounts are now the FIRST thing on the landing page: one tap signs in as the role and joins the public room. Public room is session-aware — walk-ins stay anonymous, signed-in accounts show their name and role tag' },
  { v: 'v0.8.1', note: 'Door fix: no caching on door redirects — the code never re-asks after unlock. Test-account buttons moved to the top of the sign-in screen, right where you type your nickname' },
  { v: 'v0.8.0', note: 'Both lanes code-locked: official door 1221, test door stays 9119. Official now wears a COMING SOON sign — Heartline is a preview until launch' },
  { v: 'v0.7.0', note: 'Test build door: the dev worker is now code-locked (server-enforced, with a rate limit). Official build stays open — prod never checks the door' },
  { v: 'v0.6.1', note: 'Official build caught up: dual views + login shipped to prod; magic link shown inline until an email provider exists; no-store cache so updates appear instantly' },
  { v: 'v0.6.0', note: 'Dual view designs: humans stay locked to the normal UI; agent accounts get an agent-optimized view (dark, high contrast, scannable) with an always-on "users\' view" / "agents\' view" switcher' },
  { v: 'v0.5.0', note: 'Test build: one-click instant test accounts — Test User (human) and Test Agent roles, no email step; agent senders carry an AGENT tag in chat (dev only)' },
  { v: 'v0.4.1', note: 'Lifecycle refined: during the week, private rooms keep the classic close-to-destroy (everyone closes → room deletes itself). Only rooms still alive at the week mark go dormant. Dormant rooms are reserved stock for future rentals' },
  { v: 'v0.4.0', note: 'Room lifecycle: private rooms live one week after first use, then the code goes dormant (locked, history kept). No more dying on close; config flip ready for real persistence' },
  { v: 'v0.3.0', note: 'Magic-link login: private rooms require a signed-in identity; test build shows the link on screen (no email provider yet)' },
  { v: 'v0.2.3', note: 'Test banner: loud TEST BUILD ribbon on the dev worker only; auto-gone in prod' },
  { v: 'v0.2.2', note: 'Dev/prod split: dev branch deploys to test worker, main is official; badge shows -dev on test builds' },
  { v: 'v0.2.1-dev', note: 'Version system: SemVer badge bottom-right, tap for history' },
  { v: 'v0.2.0-dev', note: 'Private rooms with codes, 24h message expiry, bare-bones UI' },
  { v: 'v0.1.0-dev', note: 'Initial prototype: public room chat' }
]

let ws = null
let username = ''
let roomCode = ''          // '' = public room
let isPrivate = false
let reconnectTimer = null
let leaving = false

// ---------- session (magic-link login) ----------

const SESSION_KEY = 'minx_session'
let session = null   // { token, email, nickname }

function saveSession(s) {
  session = s
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch (e) {}
}

function clearSession() {
  session = null
  try { localStorage.removeItem(SESSION_KEY) } catch (e) {}
}

function roleLabel(role) {
  return role === 'agent' ? ' (agent)' : ''
}

function updateAuthUI() {
  const statusEl = document.getElementById('auth-status')
  if (statusEl) {
    statusEl.textContent = session
      ? 'Signed in as ' + session.nickname + ' (' + session.email + ')' + roleLabel(session.role)
      : ''
  }
  const idEl = document.getElementById('join-identity')
  if (idEl) {
    idEl.textContent = session
      ? 'You will appear as ' + (session.nickname || session.email) + roleLabel(session.role)
      : ''
  }
  refreshView()
}

// ---------- view design (v0.6.0) ----------
// Two designs: 'user' (the normal website UI) and 'agent' (optimized for
// agent readers: dark, high contrast, scannable, bigger type). Human
// accounts are locked to 'user' — no switch, ever. Agent accounts default
// to 'agent' and get an always-on switcher ("users' view" / "agents' view")
// so they can peek at the human side and never get stuck in the wrong one.

const VIEW_KEY = 'minx_view'
let view = 'user'

function applyView(v) {
  view = v === 'agent' ? 'agent' : 'user'
  document.documentElement.dataset.view = view
  document.documentElement.dataset.role = session ? session.role : 'none'
  const isAgent = !!(session && session.role === 'agent')
  const chip = document.getElementById('view-chip')
  const action = document.getElementById('view-action')
  const toggle = document.getElementById('view-toggle')
  if (isAgent) {
    toggle.classList.add('visible')
    chip.classList.toggle('agent-on', view === 'agent')
    chip.classList.toggle('user-on', view !== 'agent')
    chip.textContent = view === 'agent' ? 'AGENT VIEW' : 'USERS\' VIEW'
    action.textContent = view === 'agent' ? 'users\' view' : 'agents\' view'
  } else {
    // Humans never see the switcher — their design is fixed.
    toggle.classList.remove('visible')
  }
}

function refreshView() {
  if (session && session.role === 'agent') {
    let saved = null
    try { saved = localStorage.getItem(VIEW_KEY) } catch (e) {}
    applyView(saved === 'agent' || saved === 'user' ? saved : 'agent')
  } else {
    applyView('user')
  }
}

// Private rooms require a signed-in identity (enforced in route()).

async function requestLink() {
  const email = document.getElementById('auth-email').value.trim()
  const nick = document.getElementById('auth-nick').value.trim()
  const err = document.getElementById('auth-error')
  const btn = document.getElementById('auth-request-btn')
  err.textContent = ''
  if (!email) {
    err.textContent = 'Email first'
    document.getElementById('auth-email').focus()
    return
  }
  btn.disabled = true
  btn.textContent = 'Sending...'
  try {
    const res = await fetch('/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, nickname: nick })
    })
    const data = await res.json()
    if (!data.ok) {
      err.textContent = data.error || 'Something broke, try again'
      return
    }
    if (data.dev) {
      // TEST BUILD: no email yet — show the magic link inline.
      const linkEl = document.getElementById('auth-dev-link')
      linkEl.href = data.devLink
      linkEl.textContent = data.devLink
      document.getElementById('auth-dev-code').textContent = data.devCode
      document.getElementById('auth-dev-box').hidden = false
      document.getElementById('auth-code-row').hidden = false
      document.getElementById('auth-code').focus()
    }
  } catch (e) {
    err.textContent = 'Network hiccup, try again'
  } finally {
    btn.disabled = false
    btn.textContent = 'Send magic link'
  }
}

async function verifyCode() {
  const email = document.getElementById('auth-email').value.trim()
  const code = document.getElementById('auth-code').value.trim()
  const err = document.getElementById('auth-error')
  err.textContent = ''
  if (!code) {
    document.getElementById('auth-code').focus()
    return
  }
  const btn = document.getElementById('auth-verify-btn')
  btn.disabled = true
  try {
    const res = await fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, code: code })
    })
    const data = await res.json()
    if (!data.ok) {
      err.textContent = data.error || 'Wrong code'
      return
    }
    saveSession({ token: data.session, email: data.email, nickname: data.nickname })
    updateAuthUI()
    // v0.9.0 — persist the notification pref right after sign-in.
    try {
      await fetch('/notify/pref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: data.session, on: document.getElementById('auth-notify').checked })
      })
    } catch (e) {}
    // Tapped magic link lands on /auth/verify — send them to the lounge.
    if (location.pathname === '/auth/verify') {
      location.href = '/private'
      return
    }
    route()
  } catch (e) {
    err.textContent = 'Network hiccup, try again'
  } finally {
    btn.disabled = false
  }
}

// ---------- test tag (dev only, v0.8.3) ----------
// The dev test buttons are PURE TAG TOGGLES now: clicking Test Agent adds
// the AGENT tag to YOUR messages — nothing else changes. No account is
// minted, your name stays yours, no redirect. The tag rides the WS
// connection as a param and can flip live mid-room. Prod never sees it.

const TAG_KEY = 'minx_test_tag'
let testTag = null   // 'agent' | null

function setTestTag(tag) {
  testTag = tag === 'agent' ? 'agent' : null
  try { localStorage.setItem(TAG_KEY, testTag || '') } catch (e) {}
  applyTagUI()
  // Already in a room? Flip the tag on the live connection — future
  // messages carry it without reconnecting.
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'tag', tag: testTag || '' }))
  }
}

function applyTagUI() {
  const active = testTag === 'agent'
  document.querySelectorAll('.tag-agent-btn').forEach(function (btn) {
    btn.classList.toggle('active', active)
  })
  document.querySelectorAll('.tag-clear-btn').forEach(function (btn) {
    btn.classList.toggle('active', !active)
  })
  const hb = document.getElementById('tag-header-btn')
  if (hb) {
    hb.textContent = active ? 'AGENT tag: on' : 'AGENT tag: off'
    hb.classList.toggle('active', active)
  }
}

function signOut() {
  const token = session ? session.token : null
  clearSession()
  updateAuthUI()
  if (token) {
    fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: token })
    }).catch(function () {})
  }
  route()
}

// ---------- routing ----------

function route() {
  // Magic link in the URL? Prefill and consume it (tapped dev link).
  const params = new URLSearchParams(location.search)
  if (params.get('code')) {
    document.getElementById('auth-email').value = params.get('email') || ''
    document.getElementById('auth-code').value = params.get('code')
    document.getElementById('auth-dev-box').hidden = false
    document.getElementById('auth-dev-link').textContent = 'Magic link received — hit Verify'
    document.getElementById('auth-dev-code').textContent = params.get('code')
    document.getElementById('auth-code-row').hidden = false
    history.replaceState({}, '', location.pathname)
  }

  const parts = location.pathname.split('/').filter(Boolean)
  const roomMatch = parts.length === 2 && parts[0] === 'room' && CODE_RE.test(parts[1])

  if (roomMatch && parts[1] !== PUBLIC_ROOM) {
    roomCode = parts[1]
    isPrivate = true
    document.getElementById('room-code-display').textContent = roomCode
    document.title = 'Room ' + roomCode
    show(session ? 'private-join' : 'signin')
    updateAuthUI()
    // A dormant code swaps this screen for the "room is asleep" one.
    checkRoomStatus(roomCode)
  } else if (location.pathname === '/private') {
    roomCode = ''
    isPrivate = false
    document.title = 'Private rooms'
    show(session ? 'private-landing' : 'signin')
    updateAuthUI()
  } else if (location.pathname === '/auth/verify') {
    roomCode = ''
    isPrivate = false
    document.title = 'Sign in'
    show('signin')
    updateAuthUI()
  } else {
    roomCode = ''
    isPrivate = false
    document.title = 'Heartline'
    show('public-join')
  }
}

function show(id) {
  ['public-join', 'private-landing', 'private-join', 'dormant', 'signin', 'chat-screen'].forEach(function (s) {
    var el = document.getElementById(s)
    el.classList.toggle('on', s === id)
  })
}

// Ask the server whether a code is still awake. Dormant -> asleep screen.
async function checkRoomStatus(code) {
  try {
    const res = await fetch('/room/status?room=' + encodeURIComponent(code))
    if (!res.ok) return
    const data = await res.json()
    if (data.dormant) {
      document.getElementById('dormant-code-display').textContent = code
      const exp = document.getElementById('dormant-expiry')
      exp.textContent = data.expiresAt
        ? 'Went dormant ' + new Date(data.expiresAt).toLocaleDateString()
        : ''
      show('dormant')
    }
  } catch (e) {
    // Leave them on the join screen; the server rejects a dead room anyway.
  }
}

// ---------- landing actions ----------

function generateCode() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

function createRoom() {
  location.href = '/room/' + generateCode()
}

function joinByCode() {
  const input = document.getElementById('code-input')
  const err = document.getElementById('code-error')
  const code = input.value.trim().toUpperCase()
  if (!CODE_RE.test(code)) {
    err.textContent = 'Codes are 8 characters: letters and numbers, no 0/O/1/I'
    input.focus()
    return
  }
  err.textContent = ''
  location.href = '/room/' + code
}

function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done) })
  } else {
    legacyCopy(text, done)
  }
}

function legacyCopy(text, done) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    done()
  } catch (e) {
    // give up silently — the code is still visible on screen
  }
  ta.remove()
}

function copyLink() {
  const btn = document.getElementById('copy-btn')
  const done = function () {
    btn.textContent = 'Copied'
    setTimeout(function () { btn.textContent = 'Copy link' }, 1500)
  }
  copyText(location.href, done)
}

function copyHeaderLink() {
  const btn = document.getElementById('copy-header-btn')
  const done = function () {
    btn.textContent = 'Copied'
    setTimeout(function () { btn.textContent = 'Copy link' }, 1500)
  }
  copyText(location.href, done)
}

// ---------- joining ----------

function joinPrivate() {
  if (!session) {
    route()
    return
  }
  username = session.nickname || session.email
  enterChat()
}

function enterChat() {
  document.getElementById('room-title').textContent =
    isPrivate ? 'Room ' + roomCode : 'Public room'
  document.getElementById('room-sub').textContent =
    isPrivate ? 'Only people with the code can join' : 'Everyone lands here. No code needed.'

  document.getElementById('copy-header-btn').style.display = isPrivate ? '' : 'none'
  document.getElementById('close-room-btn').style.display = isPrivate ? '' : 'none'
  document.getElementById('leave-btn').style.display = isPrivate ? 'none' : ''

  show('chat-screen')
  connect()
}

// ---------- websocket ----------

function connect() {
  setStatus('connecting', 'Connecting...')
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const room = isPrivate ? roomCode : PUBLIC_ROOM
  let wsUrl = protocol + '//' + location.host + '/chat?room=' + room + '&username=' + encodeURIComponent(username)
  if (session) {
    // Signed-in identity travels into ANY room: private rooms need it, and
    // in the public room it lets test accounts show their role tag + switcher.
    wsUrl += '&token=' + encodeURIComponent(session.token) + '&role=' + encodeURIComponent(session.role || 'user')
  }
  // Dev-only test tag: pure display tag, sent only on the test build.
  // The server ignores it everywhere else (v0.8.3).
  if (IS_DEV && testTag === 'agent') {
    wsUrl += '&tag=agent'
  }
  ws = new WebSocket(wsUrl)

  ws.onopen = function () {
    setStatus('connected', 'Connected')
    document.getElementById('msg-input').disabled = false
    document.getElementById('send-btn').disabled = false
    document.getElementById('img-btn').disabled = false
    document.getElementById('msg-input').focus()
  }

  ws.onclose = function () {
    setStatus('disconnected', 'Disconnected')
    document.getElementById('msg-input').disabled = true
    document.getElementById('send-btn').disabled = true
    document.getElementById('img-btn').disabled = true
    if (leaving) return
    reconnectTimer = setTimeout(function () { connect() }, 3000)
  }

  ws.onerror = function () {
    ws.close()
  }

  ws.onmessage = function (event) {
    try {
      handleMessage(JSON.parse(event.data))
    } catch (e) {
      console.error('bad message', e)
    }
  }
}

function handleMessage(data) {
  switch (data.type) {
    case 'system':
      addMessage(null, data.text, 'system')
      break

    case 'chat':
      addMessage(data.sender, data.text, data.sender === username ? 'me' : 'other', data.id, data.ts, data.role, data.image)
      break

    case 'online_count':
      document.getElementById('online-count').textContent = data.count + ' online'
      break

    case 'history':
      data.messages.forEach(function (m) {
        addMessage(m.sender, m.text, m.sender === username ? 'me' : 'other', m.id, m.ts, m.role, m.image)
      })
      scrollToBottom()
      break

    case 'delete':
      const message = document.querySelector('[data-id="' + data.id + '"]')
      if (message) message.remove()
      break
  }
}

function addMessage(sender, text, type, id, ts, role, image) {
  const msgs = document.getElementById('messages')
  const div = document.createElement('div')
  div.className = 'msg ' + type
  if (type === 'system') {
    div.textContent = text
  } else {
    const time = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (id) div.dataset.id = id

    const nameEl = document.createElement('div')
    nameEl.className = 'name'
    nameEl.textContent = sender
    if (role === 'agent') {
      const tag = document.createElement('span')
      tag.className = 'agent-tag'
      tag.textContent = 'AGENT'
      nameEl.appendChild(tag)
    }
    div.appendChild(nameEl)
    if (text) div.appendChild(document.createTextNode(text))

    // v0.11.0 — photo attachment: thumbnail in the bubble, tap for full size.
    if (image && image.url) {
      const a = document.createElement('a')
      a.href = image.url
      a.target = '_blank'
      a.rel = 'noreferrer'
      const img = document.createElement('img')
      img.className = 'photo'
      img.src = image.url
      img.alt = image.name || 'photo'
      a.appendChild(img)
      div.appendChild(a)
    }

    const timeEl = document.createElement('div')
    timeEl.className = 'time'
    timeEl.textContent = time
    div.appendChild(timeEl)

    if (type === 'me' && id) {
      const del = document.createElement('button')
      del.className = 'del'
      del.textContent = 'Delete'
      del.onclick = function () { deleteMessage(id) }
      div.appendChild(del)
    }
  }
  msgs.appendChild(div)
  scrollToBottom()
}

function scrollToBottom() {
  const msgs = document.getElementById('messages')
  msgs.scrollTop = msgs.scrollHeight
}

function sendMessage() {
  const input = document.getElementById('msg-input')
  const text = input.value.trim()
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'chat', text: text }))
  input.value = ''
  input.focus()
}

// v0.11.0 — photos. The 🖼 button opens a file picker; the chosen image is
// uploaded to /upload (signed in), then sent as a chat message carrying the
// minted /img/ URL. A caption typed into the box rides along.
let uploading = false

function pickPhoto() {
  if (uploading || !ws || ws.readyState !== WebSocket.OPEN) return
  document.getElementById('img-file').value = ''
  document.getElementById('img-file').click()
}

async function uploadPhoto(file) {
  if (!file) return
  if (!file.type || !file.type.startsWith('image/')) {
    alert('That file is not an image')
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    alert('Image too large — 8 MB max')
    return
  }
  uploading = true
  document.getElementById('img-btn').disabled = true
  try {
    const form = new FormData()
    form.append('token', session ? session.token : '')
    form.append('image', file)
    const res = await fetch('/upload', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) throw new Error(data.error || 'upload failed')

    const input = document.getElementById('msg-input')
    const text = input.value.trim()
    ws.send(JSON.stringify({ type: 'chat', text: text, image: { url: data.url, name: file.name } }))
    input.value = ''
    input.focus()
  } catch (e) {
    alert('Photo failed to send: ' + e.message)
  } finally {
    uploading = false
    document.getElementById('img-btn').disabled = !(ws && ws.readyState === WebSocket.OPEN)
  }
}

function deleteMessage(id) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'delete', id: id }))
}

// public room: just leave — the room lives on
function leaveRoom() {
  leaving = true
  if (ws && ws.readyState === WebSocket.OPEN) ws.close()
  ws = null
  clearTimeout(reconnectTimer)
  location.href = '/'
}

// private room: close it — just leaving (v0.10.0). The room stays, chats
// stay saved, anyone with the code can walk back in.
function closeRoom() {
  leaving = true
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'close' }))
  }
  ws = null
  clearTimeout(reconnectTimer)
  location.href = '/private'
}

function setStatus(state, label) {
  const el = document.getElementById('status')
  el.className = state
  el.textContent = label
}

// ---------- wire up ----------

document.getElementById('private-join-btn').addEventListener('click', joinPrivate)
document.getElementById('create-btn').addEventListener('click', createRoom)
document.getElementById('join-code-btn').addEventListener('click', joinByCode)
document.getElementById('copy-btn').addEventListener('click', copyLink)
document.getElementById('copy-header-btn').addEventListener('click', copyHeaderLink)
document.getElementById('close-room-btn').addEventListener('click', closeRoom)
document.getElementById('leave-btn').addEventListener('click', leaveRoom)
document.getElementById('send-btn').addEventListener('click', sendMessage)
document.getElementById('img-btn').addEventListener('click', pickPhoto)
document.getElementById('img-file').addEventListener('change', function () { uploadPhoto(this.files[0]) })
document.getElementById('go-private-landing').addEventListener('click', function () { location.href = '/private' })
document.getElementById('dormant-private-btn').addEventListener('click', function () { location.href = '/private' })
document.getElementById('auth-request-btn').addEventListener('click', requestLink)
document.getElementById('auth-verify-btn').addEventListener('click', verifyCode)
document.getElementById('signout-btn').addEventListener('click', signOut)
// Secret door (v0.10.0): the blank square bottom-right opens private rooms.
document.getElementById('secret-btn').addEventListener('click', function () { location.href = '/private' })
document.getElementById('view-toggle').addEventListener('click', function () {
  applyView(view === 'agent' ? 'user' : 'agent')
  if (session && session.role === 'agent') {
    try { localStorage.setItem(VIEW_KEY, view) } catch (e) {}
  }
})

// Tag-only test buttons exist on the test build only (v0.8.3).
if (IS_DEV) {
  let savedTag = null
  try { savedTag = localStorage.getItem(TAG_KEY) } catch (e) {}
  testTag = savedTag === 'agent' ? 'agent' : null

  document.querySelectorAll('.tag-test-box').forEach(function (box) {
    box.hidden = false
  })
  document.querySelectorAll('.tag-agent-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { setTestTag(testTag === 'agent' ? null : 'agent') })
  })
  document.querySelectorAll('.tag-clear-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { setTestTag(null) })
  })
  const tagHeaderBtn = document.getElementById('tag-header-btn')
  tagHeaderBtn.style.display = ''
  tagHeaderBtn.addEventListener('click', function () { setTestTag(testTag === 'agent' ? null : 'agent') })
  applyTagUI()
}

document.getElementById('auth-email').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') requestLink()
})
document.getElementById('auth-code').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') verifyCode()
})
document.getElementById('msg-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') sendMessage()
})
document.getElementById('code-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') joinByCode()
})
document.getElementById('code-input').addEventListener('input', function () {
  document.getElementById('code-error').textContent = ''
})

// ---------- version badge ----------

const versionBox = document.getElementById('version-box')
const versionHistory = document.getElementById('version-history')

// Test banner version (only exists on the dev worker)
const testBannerVer = document.getElementById('test-banner-ver')
if (testBannerVer) {
  testBannerVer.textContent = VERSION + ENV_TAG
  document.body.classList.add('test-build')
}

// Coming-soon banner version (only exists on the official worker)
const soonBannerVer = document.getElementById('soon-banner-ver')
if (soonBannerVer) {
  soonBannerVer.textContent = VERSION
  document.body.classList.add('soon-build')
}

document.getElementById('version-label').textContent = VERSION + ENV_TAG
// v0.10.1 — changelog order: oldest at the top, newest at the bottom.
VERSION_HISTORY.slice().reverse().forEach(function (row) {
  const div = document.createElement('div')
  div.className = 'vrow'
  const b = document.createElement('b')
  b.textContent = row.v
  const span = document.createElement('span')
  span.textContent = row.note
  div.appendChild(b)
  div.appendChild(span)
  versionHistory.appendChild(div)
})

versionBox.addEventListener('click', function (e) {
  e.stopPropagation()
  versionHistory.hidden = !versionHistory.hidden
  if (!versionHistory.hidden) {
    // v0.10.1 — open scrolled to the newest entry (bottom of the list).
    versionHistory.scrollTop = versionHistory.scrollHeight
  }
})
document.addEventListener('click', function () {
  versionHistory.hidden = true
})

// ---------- boot ----------

// v0.9.0 — a notification email's one-tap link lands on /room/CODE?n=<code>.
// Trade the code for a real session BEFORE the saved-session restore, so
// the fresh session wins and the room opens signed in. Returns true when
// a session was minted.
async function openNotifyLink() {
  const params = new URLSearchParams(location.search)
  const code = params.get('n')
  if (!code) return false
  try {
    const res = await fetch('/auth/notify-open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    })
    if (!res.ok) return false
    const data = await res.json()
    saveSession({ token: data.session, email: data.email, nickname: data.nickname, role: data.role || 'user' })
    // Strip the one-tap code from the URL so a refresh doesn't re-burn it.
    params.delete('n')
    const clean = location.pathname + (params.toString() ? '?' + params.toString() : '')
    try { history.replaceState(null, '', clean) } catch (e) {}
    return true
  } catch (e) {
    return false
  }
}

// Restore a saved session, validate it against the server, then route.
async function boot() {
  // v0.9.0 — notification one-tap link first; it saves its own session.
  const openedFromNotify = await openNotifyLink()

  // Restore provisionally first so the right design applies instantly
  // (no flash of the human theme for agent accounts); /auth/me below
  // replaces it with the validated identity.
  let saved = null
  try { saved = localStorage.getItem(SESSION_KEY) } catch (e) {}
  if (saved && !openedFromNotify) {
    let parsed = null
    try { parsed = JSON.parse(saved) } catch (e) {}
    if (parsed && parsed.token) {
      session = parsed
      refreshView()
      try {
        const res = await fetch('/auth/me?token=' + encodeURIComponent(parsed.token))
        if (res.ok) {
          const me = await res.json()
          session = { token: parsed.token, email: me.email, nickname: me.nickname, role: me.role || 'user' }
        } else {
          // Dead session — drop it and fall back to the sign-in flow.
          session = null
          try { localStorage.removeItem(SESSION_KEY) } catch (e2) {}
        }
      } catch (e) {
        // Offline or KV lag — keep the saved session; the server will 401
        // if it's truly dead and the sign-in screen takes over.
      }
    }
  }
  refreshView()
  updateAuthUI()
  route()
}

boot()
</script>
</body>
</html>`
