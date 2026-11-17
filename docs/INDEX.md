# Index format (schema 1)

Quickstudy keeps a flat list of items in the active courses. It lives in
`chrome.storage.local` under the key `index`. You can export it with **⌘K → `>` Export index as JSON**,
which downloads `canvas-index.json`. Other tools, such as launchers or scripts, can read the format directly.

```jsonc
{
  "schema": 1,
  "generated_at": "2026-01-15T19:04:11.000Z",
  "origin": "https://example.instructure.com",   // prepend to every `url`
  "courses": [
    { "key": "course:101", "type": "course", "id": "101",
      "title": "[2] AP Biology S1 - Smith", "short": "Biology",
      "code": "BIO-2", "url": "/courses/101", "is_favorite": true }
  ],
  "items": [
    { "key": "assignment:5001", "type": "assignment", "id": "5001",
      "title": "Lab 3: Enzyme Kinetics", "course_id": "101",
      "url": "/courses/101/assignments/5001",
      "due_at": "2026-01-16T16:59:00Z", "points": 20,
      "updated_at": "...", "submission_types": ["online_upload"],
      "module": "Unit 3: Cells" }
  ]
}
```

## Keys

Every key has the form `type:id`, for example `assignment:5001` or `announcement:812`. Keys are
stable across rebuilds, so you can use them to join the index with other data.

## Types and fields

The types are `course`, `assignment`, `quiz`, `discussion`, `page`, `announcement`, `module`, `file` and `link`.

Optional fields are only present when Canvas provides them:

| Field | Present on |
|---|---|
| `due_at`, `points`, `submission_types` | assignment, quiz, graded discussion |
| `updated_at` | assignment, page, file, discussion |
| `posted_at` | announcement |
| `module` | any item that belongs to a module |
| `position` | module |
| `external_url` | link |
| `size` | file (only when the course's Files tab is visible to students) |

## Freshness

The index refreshes in the background while the browser is idle:

- **Favorite courses** (starred on the Canvas dashboard) refresh every 6 hours.
- **All other courses** refresh every 24 hours.

Some course tabs are hidden from students, often Pages or Files. When a request for one of
these is refused, the extension stops asking for that tab for a week rather than retrying on
every refresh. Files and pages in a hidden tab still reach the index through Modules.

Live search results are added to the index unless a rebuild is running.

## Using the index outside the browser

Tools outside the browser can't read extension storage, so the index has to be written to a file
or served from a local URL. Options, from least to most effort:

1. **Manual export.** Export the JSON into a folder that your tool reads.
2. **Local server.** POST the index to a local HTTP endpoint whenever it changes. This takes one
   `fetch` in `index.js` plus a `host_permissions` entry.
3. **Native messaging.** A small host program writes the file directly. Requires installing that program
   separately.
