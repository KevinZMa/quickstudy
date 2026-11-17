// Workspace: Canvas items and files rendered as side-by-side panes from the API. A link in a pane
// opens a pane to its right; panes that do not fit fold into title strips. Data is prefetched.
(() => {
  if (window.top !== window) return;
  const Q = window.Quickstudy;
  const ROUTE = /^\/courses\/(\d+)\/(assignments|pages|discussion_topics|announcements|quizzes|modules\/items)\/([^/?#]+)\/?$/;
  const FILE = /^\/(?:courses\/(\d+)\/)?files\/(\d+)(?:\/(?:preview|download))?\/?$/;
  const GDOC = /^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)/;
  const SKIP_IDS = new Set(["new", "edit", "syllabus"]);
  const MAX_CACHED = 80, SPINE = 40, DOC_W = 620, FILE_W = 780;
  const mem = new Map(); // path -> Promise<doc>

  function parse(href) {
    let u;
    try { u = new URL(href, location.href); } catch { return null; }
    const g = u.href.match(GDOC);
    if (g) return { kind: "gdoc", id: g[2], path: g[0], external: true };
    if (u.origin !== location.origin) return null;
    const f = u.pathname.match(FILE);
    if (f) return { kind: "files", course: f[1] || null, id: f[2], path: f[1] ? `/courses/${f[1]}/files/${f[2]}` : `/files/${f[2]}` };
    const m = u.pathname.match(ROUTE);
    if (!m || SKIP_IDS.has(m[3])) return null;
    return { course: m[1], kind: m[2], id: decodeURIComponent(m[3]), path: m[0].replace(/\/$/, "") };
  }
  const isFile = (ref) => ref.kind === "files" || ref.kind === "gdoc";
  const fileSrc = (ref) => (ref.external ? ref.path : location.origin + ref.path);

  async function api(path) {
    const r = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  async function fetchDoc(ref) {
    const c = ref.course, base = `/api/v1/courses/${c}`;
    if (isFile(ref)) return { kind: "file", title: null, src: fileSrc(ref), canvas: ref.path };
    if (ref.kind === "modules/items") {
      const seq = await api(`${base}/module_item_sequence?asset_type=ModuleItem&asset_id=${ref.id}`);
      const cur = seq.items && seq.items[0] && seq.items[0].current;
      if (cur && cur.type === "ExternalUrl") {
        if (GDOC.test(cur.external_url || "")) return { kind: "file", title: cur.title, src: cur.external_url.match(GDOC)[0], canvas: ref.path };
        return { kind: "link", title: cur.title, url: cur.external_url, canvas: ref.path };
      }
      const target = cur && (cur.type === "Page" ? parse(`/courses/${c}/pages/${cur.page_url}`) : cur.type === "File" ? parse(`/courses/${c}/files/${cur.content_id}`) : parse(cur.html_url || cur.url || ""));
      if (!target || target.kind === "modules/items") throw new Error("unsupported");
      return { ...(await fetchDoc(target)), title: cur.title, canvas: ref.path };
    }
    if (ref.kind === "assignments") {
      const a = await api(`${base}/assignments/${ref.id}?include[]=submission`);
      const s = a.submission || {}, types = a.submission_types || [];
      return { kind: "doc", course: c, title: a.name, html: a.description, due: a.due_at, unlock: a.unlock_at, lock: a.lock_at,
        points: a.points_possible, attempts: a.allowed_attempts > 0 ? a.allowed_attempts : null,
        type: types.filter((t) => t !== "none" && t !== "not_graded").map((t) => t.replace(/_/g, " ")).join(", "),
        sub: { at: s.submitted_at, late: s.late, secondsLate: s.seconds_late, score: s.score, graded: s.workflow_state === "graded",
          excused: s.excused, missing: s.missing, attempt: s.attempt },
        locked: a.locked_for_user ? a.lock_explanation : null, canvas: ref.path };
    }
    if (ref.kind === "pages") {
      const p = await api(`${base}/pages/${encodeURIComponent(ref.id)}`);
      return { kind: "doc", course: c, title: p.title, html: p.body, updatedAt: p.updated_at, locked: p.locked_for_user ? p.lock_explanation : null, canvas: ref.path };
    }
    if (ref.kind === "discussion_topics" || ref.kind === "announcements") {
      const d = await api(`${base}/discussion_topics/${ref.id}`);
      return { kind: "doc", course: c, title: d.title, html: d.message, posted: d.posted_at, author: d.author && d.author.display_name,
        due: d.assignment && d.assignment.due_at, points: d.assignment && d.assignment.points_possible,
        type: d.assignment ? "discussion reply" : null, replies: d.discussion_subentry_count,
        locked: d.locked_for_user ? d.lock_explanation : null, canvas: ref.path };
    }
    if (ref.kind === "quizzes") {
      const q = await api(`${base}/quizzes/${ref.id}`);
      return { kind: "doc", course: c, title: q.title, html: q.description, due: q.due_at, unlock: q.unlock_at, lock: q.lock_at, points: q.points_possible,
        type: [q.question_count && `${q.question_count} questions`, q.time_limit && `${q.time_limit} min`].filter(Boolean).join(", ") || "quiz",
        attempts: q.allowed_attempts > 0 ? q.allowed_attempts : null,
        locked: q.locked_for_user ? q.lock_explanation : null, canvas: ref.path };
    }
    throw new Error("unsupported");
  }

  // Persistent cache shared by all tabs, versioned by updated_at when known.
  let disk = {};
  const diskReady = new Promise((res) => chrome.storage.local.get(["docs2"], (d) => { disk = d.docs2 || {}; res(); }));
  let saveTimer = 0;
  function persist(path, version, doc) {
    disk[path] = { v: version || null, at: Date.now(), doc };
    const keys = Object.keys(disk);
    if (keys.length > MAX_CACHED) keys.sort((a, b) => disk[a].at - disk[b].at).slice(0, keys.length - MAX_CACHED).forEach((k) => delete disk[k]);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ docs2: disk }), 400);
  }

  // Return cached data immediately and refresh stale entries in the background.
  function get(ref, version) {
    if (isFile(ref)) return fetchDoc(ref);
    if (!version && mem.has(ref.path)) return mem.get(ref.path);
    const p = diskReady.then(() => {
      const d = disk[ref.path];
      const age = d ? Date.now() - d.at : Infinity;
      const fresh = d && (version ? d.v === version : age < (d.v ? 6 * 3600e3 : 10 * 60e3));
      if (fresh) return d.doc;
      const net = fetchDoc(ref).then((doc) => {
        const changed = !d || JSON.stringify(d.doc) !== JSON.stringify(doc);
        persist(ref.path, version || (d && d.v), doc);
        if (changed && d) for (const p of stack) if (p.ref.path === ref.path) fill(p, doc);
        return doc;
      });
      if (d && !version) { net.catch(() => {}); return d.doc; }
      return net;
    });
    p.catch(() => mem.delete(ref.path));
    mem.set(ref.path, p);
    return p;
  }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.docs2 && ch.docs2.newValue) disk = ch.docs2.newValue; });

  const prefetched = new Set();
  function prefetchFiles(refs) {
    const srcs = refs.filter((r) => r && isFile(r)).map(fileSrc).filter((s) => !prefetched.has(s));
    if (!srcs.length) return;
    srcs.forEach((s) => prefetched.add(s));
    try { chrome.runtime.sendMessage({ type: "prefetch", srcs }).catch(() => {}); } catch { /* extension reloaded */ }
  }

  // ---------- view ----------
  const host = document.createElement("div");
  host.id = "quickstudy-reader";
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    :host([hidden]) { display: none; }
    .wrap { --paper:#FBFBFA; --side:#F4F3F0; --rule:#EAEAEA; --rule-strong:#DCDBD7; --ink:#2F3437; --ink-soft:#66655F; --ink-faint:#6F6E69; --accent:#1F6C9F;
      --good:#346538; --hold:#956400; --sel:#F1F0ED;
      --sans:'SF Pro Text','SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif; --mono:'SF Mono',ui-monospace,Menlo,monospace;
      position:fixed; inset:0 var(--right, 0px) 0 0; z-index:2147482999; background:var(--side); color:var(--ink);
      font:15px/1.6 var(--sans); -webkit-font-smoothing:antialiased; }
    @media (prefers-color-scheme: dark) { .wrap { --paper:#15161A; --side:#101114; --rule:#2A2D34; --rule-strong:#3A3E47; --ink:#E6E4DF; --ink-soft:#9D9C96;
      --ink-faint:#94938B; --accent:#8CC2EC; --good:#A6CFA6; --hold:#E4C87F; --sel:#23262C; } }
    .strip { display:flex; height:100%; overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:none; }
    .pane { position:sticky; flex:0 0 var(--w); width:var(--w); height:100%; background:var(--paper); border-left:1px solid var(--rule);
      display:flex; flex-direction:column; min-width:0; transition:box-shadow 200ms ease; }
    .pane.over { box-shadow:-8px 0 18px -12px rgba(0,0,0,.35); }
    .pane.enter { animation:paneIn 150ms linear; }
    @keyframes paneIn { from { opacity:0; } }
    .pane > .bar, .pane > .body { transition:opacity 150ms linear; }
    .pane.folded > .bar, .pane.folded > .body { opacity:0; }
    @media (prefers-reduced-motion: reduce) { .pane.enter { animation:none; } .pane, .pane > .bar, .pane > .body, .spine { transition:none; } }
    .content a.active, .fi a.active { background:color-mix(in srgb, var(--accent) 14%, transparent); border-radius:3px; box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent); }
    .single .pane { flex:1 1 auto; width:auto; border-left:0; box-shadow:none; }
    .body { flex:1; overflow-y:auto; min-height:0; }
    .bar { display:flex; align-items:center; gap:14px; padding:10px 18px; border-bottom:1px solid var(--rule); font-size:13px; flex:none; min-width:0; }
    .bar .name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink-soft); }
    .bar button, .bar a { font:inherit; background:none; border:0; padding:0; cursor:pointer; color:var(--ink-soft); text-decoration:none; white-space:nowrap; }
    .bar button:hover, .bar a:hover { color:var(--ink); }
    .bar .go { color:var(--accent); font-weight:500; }
    .spine { visibility:hidden; opacity:0; transition:opacity 150ms linear, visibility 0s 150ms; position:absolute; inset:0; padding:14px 0; box-sizing:border-box; cursor:pointer; background:var(--paper);
      writing-mode:vertical-lr; font:500 13px/${SPINE}px var(--sans); color:var(--ink-soft); white-space:nowrap; overflow:hidden; z-index:2; }
    .spine:hover { color:var(--ink); }
    .folded .spine { visibility:visible; opacity:1; transition:opacity 150ms linear; }
    article { max-width:68ch; margin:0 auto; padding:28px 28px 80px; }
    h1 { font:600 23px/1.25 var(--sans); letter-spacing:-.015em; margin:0 0 8px; }
    .meta { font:12px/1.7 var(--mono); color:var(--ink-faint); margin-bottom:18px; }
    .meta .ok { color:var(--good); } .meta .missing { color:var(--ink); font-weight:600; }
    .tl { list-style:none; margin:0 0 24px; padding:0; font:12px/1 var(--mono); }
    .tl li { position:relative; display:grid; grid-template-columns:18px 76px 1fr; align-items:center; height:24px; }
    .tl li::before { content:""; position:absolute; left:6px; top:0; bottom:0; border-left:1px solid var(--rule-strong); }
    .tl li:first-child::before { top:50%; } .tl li:last-child::before { bottom:50%; }
    .tl i { position:relative; width:9px; height:9px; border-radius:50%; border:1.5px solid var(--ink-faint); background:var(--paper); margin-left:1px; box-sizing:border-box; }
    .tl .done i { background:var(--ink-faint); }
    .tl .due i { border-color:var(--ink); }
    .tl .k { color:var(--ink-faint); } .tl .v { color:var(--ink); } .tl .x { color:var(--ink-faint); margin-left:8px; }
    .tl .now { color:var(--accent); } .tl .now i { width:7px; height:7px; margin-left:2px; border:0; background:var(--accent); }
    .tl .now span { grid-column:2 / 4; }
    .lock { color:var(--hold); margin-bottom:20px; }
    .content { overflow-wrap:break-word; }
    .content img, .content video, .content iframe { max-width:100%; height:auto; }
    .content iframe { width:100%; min-height:420px; border:1px solid var(--rule); }
    .content a, .linkcard a { color:var(--accent); }
    .content table { border-collapse:collapse; max-width:100%; display:block; overflow-x:auto; }
    .content td, .content th { border:1px solid var(--rule); padding:4px 8px; }
    .content p:first-child { margin-top:0; }
    .empty, .err { color:var(--ink-faint); }
    .files { margin-top:36px; border-top:1px solid var(--rule); padding-top:18px; font-size:14px; }
    .files h2 { font:600 13px/1 var(--sans); margin:0 0 10px; }
    .files h3, .files summary { font:500 12px/1 var(--sans); color:var(--ink-faint); margin:14px 0 6px; cursor:default; }
    .files summary { cursor:pointer; padding:4px 0; }
    .files ul { list-style:none; margin:0; padding:0; }
    .fi { display:grid; grid-template-columns:36px minmax(0,1fr) auto; align-items:center; gap:8px; height:30px; padding:0 4px; border-radius:6px; }
    .fi:hover { background:var(--sel); }
    .fi a { color:var(--ink); text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .fi .ext { font:600 10px/1 var(--mono); color:var(--ink-faint); text-transform:uppercase; text-align:right; }
    .fi button { font:13px/1 var(--sans); background:none; border:0; cursor:pointer; color:var(--ink-faint); opacity:0; padding:4px; }
    .fi:hover button, .fi button.on { opacity:1; } .fi button.on { color:var(--ink); }
    .viewer { flex:1; width:100%; border:0; display:block; background:var(--paper); }
    .linkcard { padding:28px; color:var(--ink-soft); }
  </style><div class="wrap"><div class="strip"></div></div>`;
  const wrap = shadow.querySelector(".wrap"), strip = shadow.querySelector(".strip");
  let stack = [], pushed = false; // stack: [{ href, ref, el, title }]

  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const fmtDate = (s) => new Date(s).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function two(ms) {
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
  }

  // Rebuild teacher HTML into new elements from an allowlist of tags and attributes.
  const TAGS = new Set("P BR B STRONG I EM U S SUB SUP SPAN DIV A UL OL LI H1 H2 H3 H4 H5 H6 BLOCKQUOTE PRE CODE TABLE THEAD TBODY TFOOT TR TD TH CAPTION COLGROUP COL IMG IFRAME HR FIGURE FIGCAPTION VIDEO AUDIO SOURCE DL DT DD SMALL MARK ABBR".split(" "));
  const ATTRS = new Set(["href", "src", "alt", "title", "colspan", "rowspan", "width", "height", "allowfullscreen", "style", "controls", "start", "type"]);
  const safeUrl = (v) => { try { const u = new URL(v, location.href); return /^(https?|mailto):$/.test(u.protocol) ? u.href : null; } catch { return null; } };
  function clean(html) {
    const src = new DOMParser().parseFromString(html || "", "text/html").body;
    const copy = (node) => {
      if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
      if (node.nodeType !== 1) return null;
      if (!TAGS.has(node.tagName)) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OBJECT|EMBED|FORM|SVG|MATH)$/.test(node.tagName)) return null;
        const f = document.createDocumentFragment(); // unknown wrapper: keep its children
        for (const c of node.childNodes) { const k = copy(c); if (k) f.append(k); }
        return f;
      }
      const out = document.createElement(node.tagName.toLowerCase());
      for (const a of node.attributes) {
        const n = a.name.toLowerCase();
        if (!ATTRS.has(n)) continue;
        if (n === "href" || n === "src") { const u = safeUrl(a.value); if (u) out.setAttribute(n, u); continue; }
        if (n === "style" && /url\s*\(|expression|@import/i.test(a.value)) continue;
        out.setAttribute(n, a.value);
      }
      // External links open in a new tab; Google files open as panes.
      if (out.tagName === "A" && out.getAttribute("href") && new URL(out.href).origin !== location.origin && !GDOC.test(out.href)) { out.target = "_blank"; out.rel = "noopener"; }
      if (out.tagName === "IMG" || out.tagName === "IFRAME") out.setAttribute("loading", "lazy");
      if (out.tagName === "IFRAME") out.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-forms allow-presentation");
      for (const c of node.childNodes) { const k = copy(c); if (k) out.append(k); }
      return out;
    };
    return [...src.childNodes].map(copy).filter(Boolean);
  }

  function statusOf(doc) {
    const s = doc.sub;
    if (!s) return null;
    if (s.excused) return ["Excused", "ok"];
    if (s.graded && s.score != null) return [`Graded ${+s.score}${doc.points ? `/${+doc.points}` : ""}`, "ok"];
    if (s.at) return [s.late ? "Submitted late" : "Submitted", "ok"];
    if (s.missing) return ["Missing", "missing"];
    return null;
  }

  function timeline(doc) {
    const now = Date.now(), ev = [];
    if (doc.unlock) ev.push({ k: "Opens", t: doc.unlock });
    if (doc.sub && doc.sub.at) ev.push({ k: "Submitted", t: doc.sub.at, cls: "done", x: doc.sub.late ? (doc.sub.secondsLate ? `${two(doc.sub.secondsLate * 1000)} late` : "late") : "on time" });
    if (doc.due) {
      const ms = new Date(doc.due) - now, handedIn = doc.sub && (doc.sub.at || doc.sub.excused || doc.sub.graded);
      ev.push({ k: "Due", t: doc.due, cls: "due", x: ms > 0 ? `in ${two(ms)}` : handedIn ? "" : `${two(-ms)} ago` });
    }
    if (doc.lock) ev.push({ k: "Closes", t: doc.lock, x: new Date(doc.lock) > now ? `in ${two(new Date(doc.lock) - now)}` : "closed" });
    if (doc.posted && !doc.due) ev.push({ k: "Posted", t: doc.posted });
    if (!ev.length) return null;
    ev.sort((a, b) => new Date(a.t) - new Date(b.t));
    const ol = el("ol", "tl");
    let nowShown = false;
    for (const e of ev) {
      if (!nowShown && new Date(e.t) > now) { const li = el("li", "now"); li.append(el("i"), el("span", "", "now")); ol.append(li); nowShown = true; }
      const li = el("li", e.cls || "");
      li.append(el("i"), el("span", "k", e.k));
      const v = el("span"); v.append(el("span", "v", fmtDate(e.t)), e.x ? el("span", "x", e.x) : "");
      li.append(v);
      ol.append(li);
    }
    if (!nowShown) { const li = el("li", "now"); li.append(el("i"), el("span", "", "now")); ol.append(li); }
    return ol;
  }

  // ---------- pins (per document) ----------
  let pins = {};
  chrome.storage.local.get(["pins"], (d) => { pins = d.pins || {}; });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.pins) pins = ch.pins.newValue || {}; });
  function togglePin(docPath, item) {
    const list = (pins[docPath] || []).filter((p) => p.url !== item.url);
    if (list.length === (pins[docPath] || []).length) list.unshift({ title: item.title, url: item.url });
    pins = { ...pins, [docPath]: list };
    chrome.storage.local.set({ pins });
    for (const p of stack) if (p.ref.path === docPath && p.doc) fill(p, p.doc);
  }

  const extOf = (title, url) => (GDOC.test(url) ? (url.match(GDOC)[1] === "presentation" ? "slides" : url.match(GDOC)[1] === "spreadsheets" ? "sheet" : "gdoc")
    : ((String(title).match(/\.(\w{2,5})$/) || [])[1] || "file"));

  async function filesSection(p, doc, body) {
    const idx = window.QuickstudyIndex ? await window.QuickstudyIndex.load() : { items: [], courses: [] };
    const course = String(doc.course || "");
    const byUrl = new Map(idx.items.map((it) => [it.url, it]));
    const docPath = p.ref.path;
    const pinned = pins[docPath] || [];
    const pinnedUrls = new Set(pinned.map((x) => x.url));
    const linked = [], seen = new Set();
    for (const a of body.querySelectorAll("a[href]")) {
      const ref = parse(a.href);
      if (!ref || !isFile(ref)) continue;
      const url = ref.path;
      if (seen.has(url)) continue;
      seen.add(url);
      const known = byUrl.get(ref.path) || byUrl.get(`/courses/${course}/files/${ref.id}`);
      linked.push({ title: (known && known.title) || a.textContent.trim() || "File", url: known ? known.url : url });
    }
    const own = (byUrl.get(docPath) || {}).module;
    const modPos = new Map(idx.items.filter((it) => it.type === "module" && it.course_id === course).map((m) => [m.title, m.position || 0]));
    const groups = new Map();
    for (const it of idx.items) {
      if (it.course_id !== course || (it.type !== "file" && !(it.type === "link" && GDOC.test(it.external_url || "")))) continue;
      const m = it.module || "Other files";
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push({ title: it.title, url: it.type === "link" ? it.external_url.match(GDOC)[0] : it.url });
    }
    const mods = [...groups].sort((a, b) => (b[0] === own) - (a[0] === own) || (modPos.get(a[0]) ?? 1e9) - (modPos.get(b[0]) ?? 1e9));
    if (!pinned.length && !linked.length && !mods.length) return;

    const row = (f) => {
      const li = el("li", "fi");
      const a = el("a", "", f.title); a.href = f.url.startsWith("http") ? f.url : location.origin + f.url; a.title = f.title;
      const pin = el("button", pinnedUrls.has(f.url) ? "on" : "", pinnedUrls.has(f.url) ? "★" : "☆");
      pin.title = pinnedUrls.has(f.url) ? "Unpin" : "Pin to this page";
      pin.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); togglePin(docPath, f); });
      li.append(el("span", "ext", extOf(f.title, f.url)), a, pin);
      return li;
    };
    const list = (items) => { const ul = el("ul"); for (const f of items) ul.append(row(f)); return ul; };
    const sec = el("section", "files");
    sec.append(el("h2", "", "Files"));
    if (pinned.length) sec.append(el("h3", "", "Pinned"), list(pinned));
    if (linked.length) sec.append(el("h3", "", "In the text"), list(linked));
    mods.forEach(([name, items], i) => {
      const d = el("details");
      if (name === own || (!own && i === 0)) d.open = true;
      d.append(el("summary", "", `${name} · ${items.length}`), list(items));
      sec.append(d);
    });
    body.append(sec);
    prefetchFiles([...pinned, ...linked, ...(mods[0] ? mods[0][1] : [])].slice(0, 8).map((f) => parse(f.url)));
  }

  function fill(p, doc) {
    p.doc = doc;
    const body = p.el.querySelector(".body");
    if (doc.kind === "file") {
      p.el.style.setProperty("--w", `${FILE_W}px`);
      if (!body.querySelector("iframe.viewer")) {
        const f = el("iframe", "viewer");
        f.src = chrome.runtime.getURL("viewer.html") + `?src=${encodeURIComponent(doc.src)}&origin=${encodeURIComponent(location.origin)}`;
        body.replaceChildren(f);
        body.style.display = "flex";
      }
      setTitle(p, doc.title || p.title || "File");
      if (!doc.title && window.QuickstudyIndex) window.QuickstudyIndex.load().then((idx) => {
        const it = idx.items.find((x) => x.url === p.ref.path);
        if (it && p.title === "File") setTitle(p, it.title);
      });
      return;
    }
    if (doc.kind === "link") {
      const card = el("div", "linkcard");
      const a = el("a", "", doc.url); a.href = doc.url; a.target = "_blank"; a.rel = "noopener";
      card.append("This item is a link to another site: ", a);
      body.replaceChildren(card);
      setTitle(p, doc.title || "Link");
      return;
    }
    const scroll = body.scrollTop;
    const art = el("article");
    const meta = el("div", "meta");
    const bits = [];
    const st = statusOf(doc);
    if (doc.points) bits.push([`${+doc.points} pts`]);
    if (doc.type) bits.push([doc.type]);
    if (doc.attempts) bits.push([`${doc.sub && doc.sub.attempt ? `attempt ${doc.sub.attempt} of ` : ""}${doc.attempts} attempts`]);
    if (st) bits.push(st);
    if (doc.author) bits.push([doc.author]);
    if (doc.replies) bits.push([`${doc.replies} replies`]);
    bits.forEach(([t, c], i) => { if (i) meta.append(" · "); meta.append(el("span", c || "", t)); });
    const content = el("div", "content");
    const nodes = clean(doc.html);
    nodes.length ? content.append(...nodes) : content.append(el("p", "empty", "No description."));
    art.append(el("h1", "", doc.title || "Untitled"));
    if (bits.length) art.append(meta);
    const tl = timeline(doc);
    if (tl) art.append(tl);
    if (doc.locked) art.append(el("p", "lock", doc.locked));
    art.append(content);
    body.replaceChildren(art);
    body.scrollTop = scroll;
    setTitle(p, doc.title || "Untitled");
    filesSection(p, doc, art).then(markActive, () => {});
    markActive();
  }

  function setTitle(p, t) {
    p.title = t;
    p.el.querySelector(".name").textContent = t;
    p.el.querySelector(".spine").textContent = t;
    if (p === stack[stack.length - 1] && !p.ref.external) document.title = `${t} · Canvas`;
  }

  function makePane(href) {
    const ref = parse(href);
    const pane = el("section", "pane enter");
    pane.addEventListener("animationend", () => pane.classList.remove("enter"), { once: true });
    pane.style.setProperty("--w", `${isFile(ref) ? FILE_W : DOC_W}px`);
    const bar = el("div", "bar");
    const name = el("span", "name", "");
    const go = el("a", "go", ref.kind === "gdoc" ? "Open in Google" : "Open in Canvas");
    go.href = ref.path;
    if (ref.external) { go.target = "_blank"; go.rel = "noopener"; }
    const x = el("button", "close", "✕"); x.title = "Close this pane";
    bar.append(name, go, x);
    const spine = el("div", "spine", "");
    const body = el("div", "body");
    body.append(el("p", "empty", ""));
    pane.append(spine, bar, body);
    const p = { href, ref, el: pane, title: "" };
    x.addEventListener("click", () => closePane(stack.indexOf(p)));
    spine.addEventListener("click", () => reveal(stack.indexOf(p)));
    go.addEventListener("click", (e) => { if (ref.external) return; e.preventDefault(); location.assign(ref.path); });
    // Delay the loading text so cached opens do not flash.
    let settled = false;
    setTimeout(() => { if (!settled) body.replaceChildren(el("p", "empty", "Loading…")); }, 60);
    get(ref).then((doc) => { settled = true; fill(p, doc); }).catch(() => {
      settled = true;
      if (stack.length === 1 && stack[0] === p && !ref.external) return location.assign(ref.path); // fall back to the real page
      const msg = el("p", "err", "Couldn't open this here. ");
      const a = el("a", "", "Open in Canvas"); a.href = ref.path; msg.append(a);
      body.replaceChildren(el("article")); body.firstChild.append(msg);
    });
    return p;
  }

  // ---------- stack ----------
  let stacks = {};
  chrome.storage.local.get(["stacks"], (d) => { stacks = d.stacks || {}; });
  function remember() {
    if (!stack.length) return;
    stacks[stack[0].ref.path] = stack.map((p) => p.href);
    const keys = Object.keys(stacks);
    if (keys.length > 50) delete stacks[keys[0]];
    chrome.storage.local.set({ stacks });
  }

  function setStack(hrefs, { replace = false } = {}) {
    const next = hrefs.map((h, i) => (stack[i] && stack[i].href === h ? stack[i] : makePane(h)));
    stack = next;
    strip.replaceChildren(...stack.map((p) => p.el));
    layout();
    markActive();
    const last = [...stack].reverse().find((p) => !p.ref.external);
    if (last) {
      const state = { ctlStack: stack.map((p) => p.href) };
      if (!pushed && !replace) { history.pushState(state, "", last.ref.path); pushed = true; } else history.replaceState(state, "", last.ref.path);
      if (last.title) document.title = `${last.title} · Canvas`;
    }
    remember();
  }

  function layout() {
    wrap.classList.toggle("single", stack.length === 1);
    stack.forEach((p, i) => { p.el.style.left = `${i * SPINE}px`; p.el.style.zIndex = String(i + 1); p.el.dataset.i = String(i); });
    fold();
  }
  function fold() {
    const sl = strip.scrollLeft;
    let x = 0;
    const lefts = stack.map((p) => { const l = x; x += p.el.offsetWidth; return l; });
    const vis = (i) => Math.max(i * SPINE, lefts[i] - sl);
    stack.forEach((p, i) => {
      p.el.classList.toggle("folded", i < stack.length - 1 && vis(i + 1) - vis(i) < SPINE + 80);
      p.el.classList.toggle("over", i > 0 && lefts[i] - sl < i * SPINE + 1);
    });
  }
  function markActive() {
    stack.forEach((p, i) => {
      const next = stack[i + 1];
      for (const a of p.el.querySelectorAll("a.active")) a.classList.remove("active");
      if (!next) return;
      for (const a of p.el.querySelectorAll(".content a[href], .fi a[href]")) {
        const r = parse(a.href);
        if (r && r.path === next.ref.path) a.classList.add("active");
      }
    });
  }
  strip.addEventListener("scroll", fold, { passive: true });
  // Vertical wheel over a title strip scrolls horizontally.
  strip.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || !e.composedPath().some((n) => n.classList && n.classList.contains("spine"))) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
  addEventListener("resize", () => { if (!host.hidden) fold(); });
  function reveal(i) {
    let x = 0;
    for (let k = 0; k < i; k++) x += stack[k].el.offsetWidth;
    strip.scrollTo({ left: x - i * SPINE, behavior: "smooth" });
  }
  const toEnd = () => requestAnimationFrame(() => { strip.scrollTo({ left: strip.scrollWidth, behavior: "smooth" }); fold(); });

  function show() {
    if (!host.isConnected) (document.body || document.documentElement).append(host);
    setRight();
    host.hidden = false;
    document.documentElement.style.overflow = "hidden";
    // Disable swipe navigation while the workspace is open.
    document.documentElement.style.overscrollBehaviorX = "none";
  }
  function setRight() {
    wrap.style.setProperty("--right", document.documentElement.classList.contains("ctl-open") ? "300px" : "0px");
  }

  // after: index of the pane containing the clicked link; panes to its right are replaced.
  // beside: append. Otherwise start a new workspace, restoring this item's saved panes.
  function open(href, { after = null, beside = false } = {}) {
    const ref = parse(href);
    if (!ref) return false;
    const h = ref.path;
    show();
    if (!stack.length || (after == null && !beside)) {
      const saved = stacks[ref.path];
      setStack(saved && saved[0] === h ? saved : [h]);
    } else {
      const have = stack.findIndex((p) => p.href === h);
      if (have >= 0 && after == null) { reveal(have); return true; }
      const keep = after == null ? stack.length : after + 1;
      setStack([...stack.slice(0, keep).map((p) => p.href).filter((x) => x !== h), h]);
    }
    toEnd();
    return true;
  }

  function closePane(i) {
    const rest = stack.filter((_, k) => k !== i).map((p) => p.href);
    if (!rest.length) return back();
    setStack(rest);
    fold();
  }
  function closeFrom(i) {
    if (i <= 0) return back();
    setStack(stack.slice(0, i).map((p) => p.href));
  }
  function close() {
    host.hidden = true;
    stack = []; strip.replaceChildren();
    document.documentElement.style.overflow = "";
    document.documentElement.style.overscrollBehaviorX = "";
  }

  const shell = () => !!window.__ctlShell;
  const back = () => (pushed ? history.back() : shell() ? location.assign("/") : close());
  addEventListener("popstate", (e) => {
    if (e.state && e.state.ctlStack) { pushed = !shell(); show(); setStack(e.state.ctlStack, { replace: true }); }
    else if (!shell()) { close(); pushed = false; }
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || host.hidden || (!pushed && shell())) return;
    if (stack.length > 1) closeFrom(stack.length - 1); else back();
  });
  new MutationObserver(setRight).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  // File name reported by the viewer.
  addEventListener("message", (e) => {
    if (!e.data || !e.data.qsViewer) return;
    for (const p of stack) {
      const f = p.el.querySelector("iframe.viewer");
      if (f && e.source === f.contentWindow && e.data.name) setTitle(p, e.data.name);
    }
  });

  window.QuickstudyReader = {
    open: (href, opts) => !!parse(href) && open(href, opts),
    isOpen: () => !host.hidden && stack.length > 0,
    pin: (item) => {
      const p = stack.find((x) => !isFile(x.ref));
      if (!p) return null;
      togglePin(p.ref.path, { title: item.title, url: item.url });
      return p.title;
    },
  };

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m && m.type === "ctl-open") reply(window.QuickstudyReader.open(m.url));
  });
  if (window.__ctlShell) {
    show();
    setStack([window.__ctlShell], { replace: true });
  }

  // Intercept plain left-clicks on supported links, ignoring clicks on buttons inside links.
  const anchorFrom = (e) => {
    for (const n of e.composedPath()) {
      if (n.tagName === "BUTTON" || n.tagName === "INPUT" || n.tagName === "SUMMARY") return null;
      if (n.tagName === "A" && n.href) return n;
    }
    return null;
  };
  const paneFrom = (e) => { const n = e.composedPath().find((x) => x.classList && x.classList.contains("pane")); return n ? Number(n.dataset.i) : null; };
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = anchorFrom(e);
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.classList.contains("go")) return;
    if (!parse(a.href)) return;
    e.preventDefault();
    open(a.href, { after: paneFrom(e), beside: e.altKey && !host.hidden });
  }, true);

  // Prefetch on hover.
  let hoverTimer = 0;
  document.addEventListener("pointerover", (e) => {
    const a = anchorFrom(e);
    if (!a) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const ref = parse(a.href);
      if (!ref) return;
      if (isFile(ref)) prefetchFiles([ref]); else get(ref).catch(() => {});
    }, 70);
  }, true);

  // Prefetch open tasks that changed, two at a time.
  async function prefetchTasks(items) {
    const now = Date.now(), soon = now + 8 * 864e5;
    const todo = (items || []).filter((it) => {
      const done = Q.isDone(it);
      const t = new Date(it.plannable_date).getTime();
      return !done && t < soon && it.plannable_type !== "announcement";
    }).slice(0, 30);
    await diskReady;
    const queue = todo.map((it) => ({ ref: parse(it.html_url), v: it.updated || null })).filter((x) => x.ref && !isFile(x.ref) && !(disk[x.ref.path] && disk[x.ref.path].v === x.v && x.v));
    const worker = async () => { for (let x; (x = queue.shift());) await get(x.ref, x.v).catch(() => {}); };
    await Promise.all([worker(), worker()]);
  }
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  idle(() => chrome.storage.local.get(["items"], (d) => prefetchTasks(d.items)));
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.items) idle(() => prefetchTasks(ch.items.newValue)); });
})();
