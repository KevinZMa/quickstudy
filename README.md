# Quickstudy

Quickstudy is a small Chrome extension, built on Manifest V3, that makes Canvas LMS faster and
easier to read. It has no build step, no dependencies and no background page.

## Features

- **Task panel.** A list of upcoming work stays docked on every Canvas page. It's grouped into
  Overdue, Today, Tomorrow, Next 7 days and Later. A progress ring shows how much of this week's
  work is done, and you can filter the list by course.
- **Instant reader.** Assignments, pages, discussions, announcements and quizzes open in a
  clean reading view built from Canvas's API. The data is fetched ahead of time (on hover, or in the
  background for upcoming tasks), so most items open without waiting on the network.
  **Open in Canvas** loads the full page whenever you need to submit something.
- **⌘K / Ctrl+K search.** Searches everything in your active courses. Prefixes narrow the
  results to one type, and Tab on a course limits the search to that course.
- **Toolbar popup.** The same task list as the panel. A click opens the task on Canvas, using a
  fast path when the current tab isn't Canvas.
- **Telemetry blocking.** Blocks Pendo usage analytics and Sentry error reporting on Canvas pages.

### Search prefixes

| Prefix | Searches |
|---|---|
| `*` | courses |
| `#` | assignments, quizzes, graded discussions |
| `/` | pages |
| `!` | announcements |
| `^` | modules |
| `.` | files and links |
| `>` | commands |

### Palette keys

| Key | Action |
|---|---|
| ↵ | open in the reader |
| ⌘↵ | open the full Canvas page in a new tab |
| ⇥ (on a course) | search inside that course |
| ⌫ (in an empty box) | leave the course |
| Esc | clear the box, then close |
| ↑ ↓ or Ctrl-N/P | move the selection |

## Install

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Open your school's Canvas site once. The popup remembers it after that.

The extension runs on `*.instructure.com`. Schools that host Canvas on their own domain
(for example `canvas.school.edu`) need that domain added to `host_permissions`, `content_scripts`
and the `initiatorDomains` in `rules.json`.

## How it works

| File | Role |
|---|---|
| `core.js` | Task list UI and data, shared by the panel and the popup. Fetches the Canvas planner API once, caches a trimmed copy and refreshes it when it's more than 5 minutes old. |
| `content.js` | Docks the panel on Canvas pages. |
| `reader.js` | Instant reader. Intercepts plain clicks on supported links, renders them from cached API data and keeps browser history consistent. Teacher-written HTML is rebuilt from an allowlist of tags and attributes, never inserted as-is. |
| `index.js` | Builds the search index in the background, one tab at a time. See [docs/INDEX.md](docs/INDEX.md). |
| `palette.js` | The ⌘K palette: fuzzy matching, ranking, keyboard handling. |
| `boot.js` | Fast entry from outside Canvas. The popup opens `/robots.txt#lite:<path>`, which Canvas answers far sooner than a full page. Then `boot.js` puts the real path in the address bar and the reader draws the page. Reloading gives the full Canvas page. |
| `rules.json` | Blocking rules for the services listed above. |

### Data and privacy

Everything stays in `chrome.storage.local` on your machine. The extension only talks to your
Canvas site, using your existing session. Nothing is sent anywhere else.

### Limits

- **The reader is read-only.** Submitting work, taking quizzes, replying to discussions, rubrics
  and peer reviews need the full Canvas page.
- **Module progress.** Viewing an item in the reader may not count as viewing it for
  "must view" module requirements, or in a teacher's page-view statistics. If either matters, use
  **Open in Canvas**.
- **Browsers that disable speculation rules.** In those browsers, the reader is the only way to
  make navigation feel instant.

## Tests

`tests/e2e.py` loads the unpacked extension in headless Chrome against a mocked Canvas with
fake data, then checks the panel, reader, palette and popup flows.

```sh
pip install playwright
python tests/e2e.py            # set CHROME=/path/to/chrome if needed
```

## Disclaimer

This project is not affiliated with or endorsed by Instructure. Canvas is a trademark of Instructure, Inc.
