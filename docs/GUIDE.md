# Quickstudy guide

Manifest V3, no build step. The only dependency is mammoth.js, vendored.

## Features

- **Task panel.** Upcoming work, docked on every Canvas page as a vertical timeline by day. The
  right column shows one value: time late, time left when under 6 hours, or the due time when it
  is not 11:59 PM. A dashed ring marks items with nothing to upload. Completed items show the
  submission time, lateness or score.
- **Workspace.** Assignments, pages, discussions, announcements, quizzes and files open as panes
  rendered from the Canvas API, with a date timeline and a Files list (pinned, linked in the text,
  then by module). Links open a pane to the right; panes that do not fit fold into title strips.
  Selecting an item from the task list or search replaces the workspace; files from search and
  ⌥-click open beside it. Each item restores its last set of panes. Inspired by
  [Andy Matuschak](https://notes.andymatuschak.org).
- **File viewer.** PDFs in Chrome's PDF viewer, Word files via mammoth.js, and Google
  Docs/Slides/Sheets as PDF exports (requires a Google sign-in). Files are prefetched.
- **Search (⌘K / Ctrl+K).** Searches the active courses. Falls back to the Canvas API when the
  local index has few matches.
- **Toolbar popup.** The task list, available from any tab.
- **Telemetry blocking.** Blocks Pendo and Sentry requests from Canvas pages.

### Search

| Prefix | Searches |
|---|---|
| `*` | courses |
| `#` | assignments, quizzes, graded discussions |
| `/` | pages |
| `!` | announcements |
| `^` | modules |
| `.` | files and links |
| `>` | commands |

| Key | Action |
|---|---|
| ↵ | open |
| ⌥↵ | open beside the workspace |
| ⇧↵ | pin a file to the workspace |
| ⌘↵ | open the Canvas page in a new tab |
| ⇥ (on a course) | search within the course |
| ⌫ (empty query) | leave the course |
| Esc | clear, then close |
| ↑ ↓, Ctrl-N/P | move the selection |

## Install

1. Clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Open your Canvas site once; the popup remembers it.

The extension matches `*.instructure.com`. For Canvas on a custom domain, add it to
`host_permissions`, `content_scripts`, `web_accessible_resources` and `initiatorDomains` in
`rules.json`.

## Files

| File | Role |
|---|---|
| `core.js` | Task list UI and data, shared by the panel and popup. Caches the planner API for 5 minutes. |
| `content.js` | Docks the panel. |
| `reader.js` | Workspace panes, link interception, history and prefetching. Teacher HTML is rebuilt from an allowlist. |
| `index.js` | Background search index, one tab at a time. See [INDEX.md](INDEX.md). |
| `palette.js` | ⌘K search: matching, ranking, keys. |
| `boot.js` | Fast entry from the popup via `/robots.txt#lite:<path>`. |
| `viewer.html`, `viewer.js`, `files.js` | File viewer and shared file cache. |
| `bg.js` | Service worker that prefetches files. |
| `vendor/` | mammoth.js 1.9.1 (BSD-2-Clause). |
| `rules.json` | Telemetry blocking rules. |

## Privacy

Data is stored in `chrome.storage.local` and the extension cache. Requests go only to your Canvas
site, its file storage, and Google Docs when a Google file is opened, using your existing sessions.

## Limits

- Submitting work, taking quizzes, replying to discussions, rubrics and peer reviews require the
  Canvas page.
- Viewing an item in the workspace may not satisfy "must view" module requirements or count in
  page-view statistics. Use **Open in Canvas** where that matters.

## Tests

`tests/e2e.py` runs the extension in headless Chromium against a mocked Canvas.

```sh
pip install playwright && playwright install chromium
python tests/e2e.py   # CHROME=/path/to/chromium for another build
```

## Disclaimer

Not affiliated with or endorsed by Instructure. Canvas is a trademark of Instructure, Inc.
