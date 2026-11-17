// Quickstudy index: one flat, versioned list of everything in your courses.
// Schema is documented in docs/INDEX.md so other tools can read it.
(() => {
  if (window.top !== window) return;
  const SCHEMA = 1;
  const FAVORITE_TTL = 6 * 3600e3, OTHER_TTL = 24 * 3600e3, LOCK_MS = 3 * 60e3;
  const { shortName } = window.Quickstudy;

  const path = (u) => { try { return new URL(u, location.origin).pathname; } catch { return null; } };

  async function api(p, pages = 10) {
    let url = p, all = [];
    for (let i = 0; url && i < pages; i++) {
      const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      all = all.concat(j);
      const next = (r.headers.get("link") || "").match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    return all;
  }
  // Hidden course tabs answer 403/404. Remember that for a week instead of asking every refresh.
  const DENY_MS = 7 * 864e5;
  let denied = {};
  const soft = (p, pages, tag) => {
    if (tag && denied[tag] && Date.now() - denied[tag] < DENY_MS) return Promise.resolve([]);
    return api(p, pages).catch((e) => { if (tag && /^40[34]$/.test(e.message)) denied[tag] = Date.now(); return []; });
  };

  // Courses starred on the Canvas dashboard rank higher and refresh more often.
  const isFavorite = (c) => !!c.is_favorite;

  async function indexCourse(c) {
    const cid = String(c.id), base = `/api/v1/courses/${cid}`, out = new Map(), modOf = {};
    const add = (type, id, title, url, extra = {}) => {
      const key = `${type}:${id}`;
      if (!title || out.has(key)) return;
      out.set(key, { key, type, id: String(id), title: String(title).trim(), course_id: cid, url, ...extra });
    };

    const [asg, mods, pages, discs, anns, files] = await Promise.all([
      soft(`${base}/assignments?per_page=100`),
      soft(`${base}/modules?include[]=items&per_page=50`),
      soft(`${base}/pages?per_page=100&sort=title`, 10, `${cid}:pages`),
      soft(`${base}/discussion_topics?per_page=100`),
      soft(`/api/v1/announcements?context_codes[]=course_${cid}&per_page=50&start_date=${new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10)}`, 2),
      soft(`${base}/files?per_page=100&sort=updated_at&order=desc`, 3, `${cid}:files`),
    ]);

    for (const m of mods) {
      add("module", m.id, m.name, `/courses/${cid}/modules#module_${m.id}`, { position: m.position });
      for (const it of m.items || []) {
        if (it.type === "SubHeader") continue;
        if (it.type === "File") add("file", it.content_id, it.title, path(it.html_url), { module: m.name });
        else if (it.type === "ExternalUrl" || it.type === "ExternalTool") add("link", it.id, it.title, path(it.html_url), { module: m.name, external_url: it.external_url || null });
        else if (it.type === "Page") modOf[`page:${it.page_url}`] = m.name;
        else modOf[`${it.type.toLowerCase()}:${it.content_id}`] = m.name;
      }
    }
    for (const a of asg) {
      const common = { due_at: a.due_at, points: a.points_possible, updated_at: a.updated_at, submission_types: a.submission_types };
      if (a.quiz_id) add("quiz", a.quiz_id, a.name, `/courses/${cid}/quizzes/${a.quiz_id}`, { ...common, module: modOf[`quiz:${a.quiz_id}`] });
      else if (a.discussion_topic) add("discussion", a.discussion_topic.id, a.name, `/courses/${cid}/discussion_topics/${a.discussion_topic.id}`, { ...common, module: modOf[`discussion:${a.discussion_topic.id}`] });
      else add("assignment", a.id, a.name, path(a.html_url) || `/courses/${cid}/assignments/${a.id}`, { ...common, module: modOf[`assignment:${a.id}`] });
    }
    for (const p of pages) add("page", p.url, p.title, `/courses/${cid}/pages/${p.url}`, { updated_at: p.updated_at, module: modOf[`page:${p.url}`] });
    for (const d of discs) add("discussion", d.id, d.title, `/courses/${cid}/discussion_topics/${d.id}`, { updated_at: d.last_reply_at || d.posted_at });
    for (const a of anns) add("announcement", a.id, a.title, `/courses/${cid}/discussion_topics/${a.id}`, { posted_at: a.posted_at });
    for (const f of files) add("file", f.id, f.display_name, `/courses/${cid}/files/${f.id}`, { updated_at: f.updated_at, size: f.size });
    return [...out.values()];
  }

  // ---------- storage ----------
  const empty = () => ({ schema: SCHEMA, generated_at: null, courses: [], items: [], fetched: {}, denied: {} });
  let cache = null;
  function load() {
    if (cache) return Promise.resolve(cache);
    return new Promise((res) => chrome.storage.local.get(["index"], (d) => {
      cache = d.index && d.index.schema === SCHEMA ? d.index : empty();
      res(cache);
    }));
  }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.index && ch.index.newValue) { cache = ch.index.newValue; listeners.forEach((f) => f(cache)); }
  });
  const listeners = new Set();
  const save = (idx) => new Promise((res) => chrome.storage.local.set({ index: idx }, res));

  // One tab builds at a time; a stamp in storage acts as the lock.
  async function lock() {
    const d = await chrome.storage.local.get(["indexLock"]);
    if (d.indexLock && Date.now() - d.indexLock < LOCK_MS) return false;
    await chrome.storage.local.set({ indexLock: Date.now() });
    return true;
  }

  let building = null;
  function build(force = false) {
    if (building) return building;
    building = (async () => {
      if (!(await lock())) return;
      try {
        const idx = JSON.parse(JSON.stringify(await load()));
        denied = idx.denied || {};
        const courses = (await api(`/api/v1/courses?enrollment_state=active&include[]=favorites&per_page=100`)).filter((c) => c.name && !c.access_restricted_by_date);
        idx.courses = courses.map((c) => ({ key: `course:${c.id}`, type: "course", id: String(c.id), title: c.name,
          short: shortName(c.name), code: c.course_code, url: `/courses/${c.id}`, is_favorite: isFavorite(c) }));
        const live = new Set(idx.courses.map((c) => c.id));
        idx.items = idx.items.filter((it) => live.has(it.course_id));
        // Favorites first, so the courses used most are fresh soonest.
        const order = [...courses].sort((a, b) => isFavorite(b) - isFavorite(a));
        for (const c of order) {
          const cid = String(c.id), ttl = isFavorite(c) ? FAVORITE_TTL : OTHER_TTL;
          if (!force && idx.fetched[cid] && Date.now() - idx.fetched[cid] < ttl) continue;
          const items = await indexCourse(c);
          idx.items = idx.items.filter((it) => it.course_id !== cid).concat(items);
          idx.fetched[cid] = Date.now();
          idx.denied = denied;
          idx.generated_at = new Date().toISOString();
          await save(idx);
          await chrome.storage.local.set({ indexLock: Date.now() }); // keep the lock alive
        }
      } finally {
        await chrome.storage.local.remove("indexLock");
      }
    })().finally(() => { building = null; if (cache) listeners.forEach((f) => f(cache)); });
    return building;
  }

  function exportJSON() {
    return load().then((idx) => {
      const { fetched, denied: _d, ...pub } = idx;
      const blob = new Blob([JSON.stringify({ ...pub, origin: location.origin }, null, 2)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "canvas-index.json" });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  window.QuickstudyIndex = { load, build, exportJSON, onChange: (f) => listeners.add(f), isBuilding: () => !!building };

  // Refresh stale courses when the browser is idle, a few seconds after a page settles.
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 3000));
  setTimeout(() => idle(() => build().catch(() => {})), 4000);
})();
