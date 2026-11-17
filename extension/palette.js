// ⌘K / Ctrl+K palette over the Quickstudy index.
// Prefixes narrow the type (Discord-style); Tab on a course searches inside it.
(() => {
  if (window.top !== window) return;
  const { shortName, courseCode, toneFor, clock, isEndOfDay, CSS_TOKENS } = window.Quickstudy;
  const IDX = window.QuickstudyIndex;

  const PREFIX = {
    "*": { label: "Courses", types: ["course"] },
    "#": { label: "Assignments", types: ["assignment", "quiz", "discussion"] },
    "/": { label: "Pages", types: ["page"] },
    "!": { label: "Announcements", types: ["announcement"] },
    "^": { label: "Modules", types: ["module"] },
    ".": { label: "Files & links", types: ["file", "link"] },
    ">": { label: "Commands", types: ["command"] },
  };
  const TYPE_LABEL = { course: "Course", assignment: "Assignment", quiz: "Quiz", discussion: "Discussion", page: "Page",
    announcement: "Announcement", module: "Module", file: "File", link: "Link", command: "Command" };
  const MAX_ROWS = 60;
  // 16px line icons (Raycast-style): the type at a glance, without a word on every row.
  const ICON = {
    assignment: "M4 3h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM5.5 8.2l1.8 1.8 3.2-3.8",
    quiz: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM6.4 6.3a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.6-.7 1v.4M8 11.2v.1",
    discussion: "M2.5 4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11h-.5a1 1 0 0 1-1-1z",
    page: "M4 2h5l3 3v8.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5zM9 2v3h3M6 8h4M6 10.5h4",
    announcement: "M2.5 6.5v3h2l5 3v-9l-5 3zM12 6.2a2.2 2.2 0 0 1 0 3.6",
    module: "M8 2.5l5.5 2.8L8 8 2.5 5.3zM2.5 8L8 10.8 13.5 8M2.5 10.7L8 13.5l5.5-2.8",
    file: "M10 4.5 5.6 8.9a1.3 1.3 0 0 0 1.8 1.8L12 6.1a2.6 2.6 0 0 0-3.7-3.7L3.7 7a3.9 3.9 0 0 0 5.5 5.5l3.3-3.3",
    link: "M6.8 9.2l2.4-2.4M7.5 5.2l1.3-1.3a2.5 2.5 0 0 1 3.5 3.5L11 8.7M9 10.8l-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5L5.5 7.3",
    course: "M3 3.5h3.3c1 0 1.7.7 1.7 1.7V13c0-.7-.6-1.2-1.3-1.2H3zM13 3.5H9.7c-1 0-1.7.7-1.7 1.7V13c0-.7.6-1.2 1.3-1.2H13z",
    command: "M4.5 5l3 3-3 3M9 11h3",
  };
  const icon = (type) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("class", "ic"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", ICON[type] || ICON.page); s.append(p); return s;
  };

  const COMMANDS = [
    { title: "Dashboard", url: "/", kw: "home" },
    { title: "Calendar", url: "/calendar" },
    { title: "Inbox", url: "/conversations", kw: "messages mail" },
    { title: "Grades", url: "/grades" },
    { title: "Toggle task panel", run: () => chrome.storage.local.get(["open"], (d) => chrome.storage.local.set({ open: d.open === false })), kw: "tasks sidebar hide show" },
    { title: "Refresh index", run: () => IDX.build(true), kw: "reindex sync update" },
    { title: "Export index as JSON", run: () => IDX.exportJSON(), kw: "download raycast" },
  ].map((c, i) => ({ ...c, key: `command:${i}`, type: "command", id: String(i) }));

  // ---------- state ----------
  let idx = null, corpus = [], courseById = {}, recent = {}, planner = [];
  let open = false, sel = 0, rows = [], scope = null, raf = 0;

  function prepare(index) {
    idx = index;
    courseById = Object.fromEntries(index.courses.map((c) => [c.id, c]));
    corpus = [...index.courses, ...index.items, ...COMMANDS].map((it) => ({
      it, t: (it.type === "course" ? it.short : it.title).toLowerCase(), c: (courseById[it.course_id]?.short || "").toLowerCase(),
      k: ((it.kw || "") + " " + (it.module || "") + " " + (it.code || "") + " " + (it.type === "course" ? it.title : "")).toLowerCase(),
    }));
  }
  const warm = () => (idx ? Promise.resolve() : IDX.load().then(prepare));
  IDX.onChange((index) => { prepare(index); if (open) schedule(); });
  window.Quickstudy.onColors(() => { if (open) schedule(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.recent) recent = ch.recent.newValue || {};
    if (ch.items) planner = ch.items.newValue || [];
  });

  // ---------- matching ----------
  const isBoundary = (s, i) => i === 0 || !/[a-z0-9]/.test(s[i - 1]);
  // Returns [score, positions] or null. Contiguous and word-start matches score highest.
  function match(q, s) {
    const at = s.indexOf(q);
    if (at >= 0) {
      const pos = Array.from({ length: q.length }, (_, i) => at + i);
      return [(at === 0 ? 1000 : isBoundary(s, at) ? 800 : 500) - at - s.length * 0.2, pos];
    }
    let from = 0, prev = -2, sc = 0; const pos = [];
    for (const ch of q) {
      if (ch === " ") continue;
      let f = s.indexOf(ch, from);
      // Prefer the next word-start occurrence if there is one (so "ps4" hits "Problem Set 4").
      for (let j = f; j >= 0; j = s.indexOf(ch, j + 1)) { if (isBoundary(s, j)) { if (j - f < 24) f = j; break; } }
      if (f < 0) return null;
      sc += 1 + (f === prev + 1 ? 6 : 0) + (isBoundary(s, f) ? 10 : 0) - Math.min(f - from, 10) * 0.3;
      pos.push(f); prev = f; from = f + 1;
    }
    return [100 + sc - s.length * 0.2, pos];
  }

  function boost(it) {
    let b = 0;
    const r = recent[it.key];
    if (r) b += Math.min(r.n, 6) * 12 + (Date.now() - r.at < 3 * 864e5 ? 40 : 0);
    if (it.due_at) {
      const d = new Date(it.due_at) - Date.now();
      if (d > -2 * 864e5 && d < 7 * 864e5) b += 50; else if (d < -30 * 864e5) b -= 30;
    }
    if (it.type === "course") b += courseById[it.id]?.is_favorite ? 250 : 0;
    else if (courseById[it.course_id]?.is_favorite) b += 25;
    if (it.type === "announcement" && it.posted_at && Date.now() - new Date(it.posted_at) > 30 * 864e5) b -= 40;
    return b;
  }

  function search(raw) {
    let q = raw, types = null, prefix = null;
    if (q && PREFIX[q[0]]) { prefix = q[0]; types = PREFIX[prefix].types; q = q.slice(1); }
    q = q.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (const e of corpus) {
      const it = e.it;
      if (types && !types.includes(it.type)) continue;
      if (!types && it.type === "command" && !tokens.length) continue;
      if (scope && it.course_id !== scope.id) continue;
      if (scope && it.type === "course") continue;
      if (!tokens.length) { out.push({ it, s: boost(it), pos: [] }); continue; }
      let s = 0, pos = [], ok = true;
      for (const tok of tokens) {
        const m = match(tok, e.t);
        if (m) { s += m[0]; pos = pos.concat(m[1]); continue; }
        // A token can also match the course name or module ("phys lab") or keywords.
        const mc = !scope && match(tok, e.c), mk = match(tok, e.k);
        if (mc || mk) { s += Math.max(mc ? mc[0] : 0, mk ? mk[0] : 0) * 0.5; continue; }
        ok = false; break;
      }
      if (ok) out.push({ it, s: s + boost(it), pos });
    }
    if (!tokens.length && types && types.includes("assignment")) {
      // Browsing assignments: upcoming first, then most recent past.
      const now = Date.now(), t = (x) => (x.it.due_at ? new Date(x.it.due_at) - now : 1e15);
      out.sort((a, b) => (t(a) < -864e5) - (t(b) < -864e5) || (t(a) < -864e5 ? t(b) - t(a) : t(a) - t(b)));
    } else out.sort((a, b) => b.s - a.s);
    return { results: out.slice(0, MAX_ROWS), prefix, total: out.length };
  }

  // Empty box: what you opened lately, and what's due.
  function home() {
    const groups = [];
    const rec = Object.entries(recent).sort((a, b) => b[1].at - a[1].at).slice(0, 5)
      .map(([k]) => corpus.find((e) => e.it.key === k)?.it).filter(Boolean)
      .filter((it) => !scope || it.course_id === scope.id);
    if (rec.length) groups.push(["Recent", rec]);
    const byUrl = new Map(corpus.map((e) => [e.it.url, e.it]));
    const due = planner.filter((p) => {
      const done = p.planner_override ? p.planner_override.marked_complete : !!(p.submissions && (p.submissions.submitted || p.submissions.excused));
      const t = new Date(p.plannable_date) - Date.now();
      return !done && p.plannable_type !== "announcement" && t > -7 * 864e5 && t < 7 * 864e5 && (!scope || String(p.course_id) === scope.id);
    }).sort((a, b) => new Date(a.plannable_date) - new Date(b.plannable_date)).slice(0, 6)
      .map((p) => byUrl.get(new URL(p.html_url, location.origin).pathname) ||
        { key: `planner:${p.plannable_id}`, type: p.plannable_type === "quiz" ? "quiz" : "assignment", title: p.plannable.title, course_id: String(p.course_id), url: p.html_url, due_at: p.plannable_date });
    if (due.length) groups.push(["Due soon", due]);
    if (scope) {
      const inCourse = corpus.filter((e) => e.it.course_id === scope.id && e.it.type === "module").map((e) => e.it).sort((a, b) => (a.position || 0) - (b.position || 0));
      if (inCourse.length) groups.push(["Modules", inCourse.slice(0, 12)]);
    }
    return groups;
  }

  // ---------- view ----------
  const host = document.createElement("div");
  host.id = "quickstudy-palette";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${CSS_TOKENS}
    .ctl.pal { display:block; height:auto; background:none; position:fixed; inset:0; z-index:2147483646; }
    .ctl.pal[hidden] { display:none; }
    .scrim { position:absolute; inset:0; background:rgba(15,16,20,.28); }
    @media (prefers-color-scheme: dark) { .scrim { background:rgba(0,0,0,.5); } }
    .box { position:absolute; left:50%; top:12vh; transform:translateX(-50%); width:min(640px, calc(100vw - 32px));
      max-height:min(560px, 76vh); display:flex; flex-direction:column; background:var(--paper);
      border:1px solid var(--rule-strong); border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,.12); overflow:hidden; }
    .field { display:flex; align-items:center; gap:8px; padding:0 16px; border-bottom:1px solid var(--rule); min-height:52px; }
    .field input { flex:1; min-width:0; border:0; outline:0; background:none; color:var(--ink); font:16px/1.4 var(--sans); padding:14px 0; }
    .field input::placeholder { color:var(--ink-faint); }
    .scope { font:500 12px/1.8 var(--sans); padding:0 8px; border-radius:99px; background:var(--t); color:var(--ti); white-space:nowrap; }
    .mode { font:12px/1 var(--mono); color:var(--ink-faint); white-space:nowrap; }
    ul { list-style:none; margin:0; padding:6px; overflow-y:auto; flex:1; }
    li.h { font:600 11px/1 var(--sans); color:var(--ink-faint); padding:12px 10px 6px; }
    li.r { display:grid; grid-template-columns:16px minmax(0,1fr) auto; gap:10px; align-items:center; height:36px; padding:0 10px; border-radius:7px; cursor:pointer; }
    li.r[aria-selected="true"] { background:var(--sel); }
    .ic { width:16px; height:16px; fill:none; stroke:var(--ink-faint); stroke-width:1.3; stroke-linecap:round; stroke-linejoin:round; }
    li.r.course .ic { stroke:var(--ti); }
    li.r[aria-selected="true"] .ic { stroke:var(--ink); }
    .line { display:flex; align-items:baseline; gap:8px; min-width:0; }
    .t { flex:none; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink); }
    .t b { font-weight:600; }
    .m { flex:1; min-width:0; font-size:12px; color:var(--ink-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .acc { display:flex; align-items:baseline; gap:8px; font:11px/1 var(--mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
    .code { font-weight:600; letter-spacing:.02em; color:var(--ti); }
    .d { color:var(--ink-faint); }
    .d.soon { color:var(--hold); }
    .ret { color:var(--ink-faint); visibility:hidden; }
    li.r[aria-selected="true"] .ret { visibility:visible; }
    .tips { display:flex; flex-wrap:wrap; gap:6px 14px; padding:10px 16px 12px; color:var(--ink-faint); font-size:12px; }
    .tips button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; }
    .tips button:hover { color:var(--ink); }
    .tips code { font:12px var(--mono); color:var(--ink-soft); }
    .foot { display:flex; gap:14px; padding:8px 16px; border-top:1px solid var(--rule); font:11px/1.6 var(--mono); color:var(--ink-faint); }
    .foot .st { margin-left:auto; }
    .none { padding:22px 12px; color:var(--ink-faint); }
  </style>
  <div class="ctl pal" hidden><div class="scrim"></div>
    <div class="box" role="dialog" aria-label="Search Canvas">
      <div class="field"><span class="scope" hidden></span>
        <input role="combobox" aria-expanded="true" aria-controls="res" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search Canvas">
        <span class="mode"></span></div>
      <ul id="res" role="listbox"></ul>
      <div class="foot"><span>↵ open</span><span>⌘↵ new tab</span><span>⇥ search course</span><span class="st"></span></div>
    </div></div>`;
  const root = shadow.querySelector(".pal"), input = shadow.querySelector("input"), list = shadow.querySelector("ul"),
    scopeEl = shadow.querySelector(".scope"), modeEl = shadow.querySelector(".mode"), statusEl = shadow.querySelector(".st");

  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const tone = (node, cid) => window.Quickstudy.paint(node, cid);

  function highlight(title, pos) {
    const f = document.createDocumentFragment(), set = new Set(pos);
    let run = "", on = false;
    const flush = () => { if (run) f.append(on ? el("b", "", run) : document.createTextNode(run)); run = ""; };
    [...title].forEach((ch, i) => { const m = set.has(i); if (m !== on) { flush(); on = m; } run += ch; });
    flush();
    return f;
  }

  // Same compact style as the panel: "today", "tmrw 8:59a", "Fri", "Nov 22".
  function fmtDue(s) {
    const d = new Date(s), now = new Date();
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
    const t = isEndOfDay(d) ? "" : ` ${clock(d)}`;
    if (days === 0) return "today" + t;
    if (days === 1) return "tmrw" + t;
    if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: "short" }) + t;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() && { year: "2-digit" }) });
  }

  function rowEl(it, pos, i) {
    const li = el("li", "r " + it.type);
    li.id = `r${i}`; li.setAttribute("role", "option");
    if (it.type === "course") tone(li, it.id);
    const label = it.type === "course" ? it.short : it.title;
    const title = el("span", "t"); title.append(highlight(label, pos || []));
    // Secondary text sits on the same line, after the title (Raycast's subtitle).
    const sub = it.type === "course" ? it.title : it.type === "command" ? (it.url && !it.url.startsWith("http") ? it.url : "") : it.module || "";
    const line = el("span", "line"); line.append(title);
    if (sub) line.append(el("span", "m", sub));
    const acc = el("span", "acc");
    const c = courseById[it.course_id];
    if (c && !scope) acc.append(tone(el("span", "code", courseCode(c.title)), it.course_id));
    if (it.due_at) {
      const ms = new Date(it.due_at) - Date.now();
      acc.append(el("span", "d" + (ms > 0 && ms < 864e5 ? " soon" : ""), fmtDue(it.due_at)));
    }
    acc.append(el("span", "ret", "↵"));
    li.title = [it.title, c && c.title, it.due_at && `Due ${new Date(it.due_at).toLocaleString()}`, TYPE_LABEL[it.type]].filter(Boolean).join("\n");
    li.append(icon(it.type), line, acc);
    li.addEventListener("pointermove", () => { if (sel !== i) { sel = i; paintSel(); } });
    li.addEventListener("click", (e) => go(it, e.metaKey || e.ctrlKey));
    return li;
  }

  function render() {
    raf = 0;
    const raw = input.value;
    const p = raw[0] && PREFIX[raw[0]] ? raw[0] : null;
    modeEl.textContent = p ? PREFIX[p].label : "";
    rows = [];
    const frag = document.createDocumentFragment();
    if (!raw.trim()) {
      for (const [label, items] of home()) {
        frag.append(el("li", "h", label));
        for (const it of items) { frag.append(rowEl(it, [], rows.length)); rows.push(it); }
      }
      if (!scope) {
        const tips = el("li"); tips.className = "tips";
        for (const [k, v] of Object.entries(PREFIX)) {
          const b = el("button"); b.append(el("code", "", k), ` ${v.label.toLowerCase()}`);
          b.addEventListener("click", () => { input.value = k; input.focus(); schedule(); });
          tips.append(b);
        }
        frag.append(tips);
      }
    } else {
      const { results } = search(raw);
      results.forEach((r, i) => { frag.append(rowEl(r.it, r.pos, i)); rows.push(r.it); });
      if (!results.length) frag.append(el("li", "none", idx && idx.items.length ? "No matches." : "Building the index… results appear as courses finish."));
    }
    list.replaceChildren(frag);
    sel = Math.min(sel, Math.max(rows.length - 1, 0));
    paintSel();
    const n = idx ? idx.items.length : 0;
    statusEl.textContent = IDX.isBuilding() ? `indexing… ${n} items` : n ? `${n.toLocaleString()} items` : "";
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

  function paintSel() {
    list.querySelectorAll('li.r[aria-selected="true"]').forEach((n) => n.removeAttribute("aria-selected"));
    const li = shadow.getElementById(`r${sel}`);
    if (li) { li.setAttribute("aria-selected", "true"); li.scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", li.id); }
  }

  function setScope(course) {
    scope = course;
    scopeEl.hidden = !course;
    if (course) { scopeEl.textContent = course.short; tone(scopeEl, course.id); input.placeholder = `Search in ${course.short}`; }
    else input.placeholder = "Search Canvas";
    input.value = ""; sel = 0; schedule();
  }

  function remember(it) {
    if (it.key.startsWith("planner:")) return;
    const r = recent[it.key] || { n: 0, at: 0 };
    recent[it.key] = { n: r.n + 1, at: Date.now() };
    const keys = Object.keys(recent);
    if (keys.length > 200) keys.sort((a, b) => recent[a].at - recent[b].at).slice(0, keys.length - 200).forEach((k) => delete recent[k]);
    chrome.storage.local.set({ recent });
  }

  function go(it, newTab) {
    if (!it) return;
    remember(it);
    close();
    if (it.run) return it.run();
    const url = it.url;
    if (newTab || it.newTab) return window.open(url, "_blank", "noopener");
    if (window.QuickstudyReader && window.QuickstudyReader.open(url)) return;
    location.assign(url);
  }

  function show() {
    if (open) { input.select(); return; }
    open = true;
    if (!host.isConnected) document.body.append(host);
    root.hidden = false;
    input.value = ""; sel = 0;
    input.focus();
    Promise.all([warm(), chrome.storage.local.get(["recent", "items"]).then((d) => { recent = d.recent || {}; planner = d.items || []; })]).then(render);
    render();
    if (!idx || !idx.generated_at) IDX.build().catch(() => {});
  }
  function close() { open = false; root.hidden = true; setScopeQuiet(null); }
  function setScopeQuiet(c) { scope = c; scopeEl.hidden = true; input.placeholder = "Search Canvas"; }

  input.addEventListener("input", () => { sel = 0; schedule(); });
  input.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowDown" || (e.ctrlKey && k === "n")) { e.preventDefault(); sel = Math.min(sel + 1, rows.length - 1); paintSel(); }
    else if (k === "ArrowUp" || (e.ctrlKey && k === "p")) { e.preventDefault(); sel = Math.max(sel - 1, 0); paintSel(); }
    else if (k === "PageDown") { e.preventDefault(); sel = Math.min(sel + 8, rows.length - 1); paintSel(); }
    else if (k === "PageUp") { e.preventDefault(); sel = Math.max(sel - 8, 0); paintSel(); }
    else if (k === "Enter") { e.preventDefault(); go(rows[sel], e.metaKey || e.ctrlKey); }
    else if (k === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const it = rows[sel];
      const course = it && (it.type === "course" ? courseById[it.id] : null);
      if (course) setScope(course);
    }
    else if (k === "Backspace" && !input.value && scope) { e.preventDefault(); setScope(null); }
    e.stopPropagation(); // keep Canvas's own shortcuts from seeing palette typing
  });
  shadow.querySelector(".scrim").addEventListener("click", close);

  // ⌘K / Ctrl+K anywhere on Canvas (except inside rich-text editors, where it means "insert link").
  addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k" || e.shiftKey || e.altKey) return;
    const t = e.composedPath()[0];
    if (t && t.isContentEditable) return;
    e.preventDefault(); e.stopPropagation();
    open ? close() : show();
  }, true);
  // Esc: first clears the query (or leaves the course scope), then closes. Works wherever focus is,
  // and never reaches the reader or Canvas underneath.
  addEventListener("keydown", (e) => {
    if (!open || e.key !== "Escape") return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (input.value) { input.value = ""; sel = 0; schedule(); input.focus(); }
    else if (scope) setScope(null);
    else close();
  }, true);

  // Start reading the index as soon as a modifier goes down, so the first open is warm.
  addEventListener("keydown", (e) => { if (e.key === "Meta" || e.key === "Control") warm(); }, true);

  window.QuickstudyPalette = { show, close };
})();
