---
name: playwright
description: Drive florentine-connect in a real browser with Playwright — serve the app, run its browser tests, take phone and desktop screenshots, catch console errors and layout overflow, and verify UI changes end to end. Use when asked to test, screenshot, debug or verify anything visual or interactive in this project.
---

# Playwright for florentine-connect

This project is a static web app (index.html, admin.html) with a Supabase backend.

Playwright and Chromium are already installed in Claude Code cloud sessions: `require('playwright')`
works from any directory and `chromium.launch()` needs no options.
**Never run `npx playwright install`** or add another Playwright version — it won't find the browser.
Anything else that needs a Chrome binary uses `/opt/pw-browsers/chromium` with `--headless --no-sandbox`.
(On a local machine without that path, use the project's own Playwright install.)

## 1. Serve the app

```bash
python3 -m http.server 8811   # in the background; open http://localhost:8811/
```

Wait until the URL answers (`curl -sf <url>`) before driving it.

## 2. This project

- Existing e2e: `python3 tests/e2e.py http://localhost:8811/ <screens-dir>` (Python Playwright against the fake backend `tests/fake-api.js`). Needs `pip install playwright` (do NOT run `playwright install`; launch with `executable_path="/opt/pw-browsers/chromium"` if it can't find the browser).
- Access rules (RLS) are tested separately by `tests/rls-test.mjs`.
- Test both `index.html` and `admin.html`.

## 3. Ad-hoc checks (write scripts in the scratchpad, not the repo)

```js
const { chromium, devices } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] }); // or { viewport: { width: 1280, height: 800 } }
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'shot.png', fullPage: true });
await browser.close();
```

For every visual change, check:
- **Phone and desktop** — `devices['iPhone 13']` and a 1280×800 viewport.
- **No horizontal overflow** — `document.documentElement.scrollWidth <= clientWidth`.
- **No console or page errors** (ignore `net::` noise from hosts the sandbox blocks).
- **Dark mode** if the app supports it — `page.emulateMedia({ colorScheme: 'dark' })`.
- **External services** (databases, APIs): stub them with `page.route` rather than hitting production.

## 4. Screenshots

- For the user: `deviceScaleFactor: 2` (named devices already set their own).
- For your own check: `deviceScaleFactor: 1`.
- Save them outside the repo and send them with SendUserFile; don't commit screenshots.

## 5. Playwright MCP (optional)

If the `mcp__playwright__*` tools are loaded (configured in `.mcp.json`), use them to explore
interactively: `browser_navigate` → `browser_snapshot` (accessibility tree, preferred over
screenshots for finding elements) → `browser_click` / `browser_type` → `browser_take_screenshot`.

## 6. Clean up

Stop any server you started when you're done.
