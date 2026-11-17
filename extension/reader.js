// Instant reader: opens assignments, pages, discussions and quizzes from Canvas's API
// instead of loading the full Canvas page. Data is fetched before the click (on hover,
// or ahead of time for open tasks), so opening is a local render.
(() => {
  if (window.top !== window) return;
  const ROUTE = /^\/courses\/(\d+)\/(assignments|pages|discussion_topics|announcements|quizzes|modules\/items)\/([^/?#]+)\/?$/;
  const SKIP_IDS = new Set(["new", "edit", "syllabus"]);
  const MAX_CACHED = 80;
  const mem = new Map(); // path -> Promise<doc>

  function parse(href) {
    let u;
    try { u = new URL(href, location.href); } catch { return null; }
    if (u.origin !== location.origin) return null;
    const m = u.pathname.match(ROUTE);
    if (!m || SKIP_IDS.has(m[3])) return null;
    return { course: m[1], kind: m[2], id: decodeURIComponent(m[3]), path: m[0].replace(/\/$/, "") };
  }

  async function api(path) {
    const r = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  // Normalise every content type into one small shape.
  async function fetchDoc(ref) {
    const c = ref.course, base = `/api/v1/courses/${c}`;
    if (ref.kind === "modules/items") {
      const seq = await api(`${base}/module_item_sequence?asset_type=ModuleItem&asset_id=${ref.id}`);
      const cur = seq.items && seq.items[0] && seq.items[0].current;
      const target = cur && (cur.html_url || cur.url) && parse(cur.type === "Page" ? `/courses/${c}/pages/${cur.page_url}` : cur.html_url);
      if (!target || target.kind === "modules/items") throw new Error("unsupported");
      return { ...(await fetchDoc(target)), canvas: ref.path };
    }
    if (ref.kind === "assignments") {
      const a = await api(`${base}/assignments/${ref.id}?include[]=submission`);
      const s = a.submission || {};
      return { title: a.name, html: a.description, due: a.due_at, points: a.points_possible,
        type: (a.submission_types || []).filter((t) => t !== "none" && t !== "not_graded").map((t) => t.replace(/_/g, " ")).join(", "),
        status: s.excused ? "Excused" : s.score != null && s.workflow_state === "graded" ? `Graded ${+s.score}/${+a.points_possible}` :
          s.submitted_at ? "Submitted" : s.missing ? "Missing" : null,
        locked: a.locked_for_user ? a.lock_explanation : null, canvas: ref.path };
    }
    if (ref.kind === "pages") {
      const p = await api(`${base}/pages/${encodeURIComponent(ref.id)}`);
      return { title: p.title, html: p.body, updatedAt: p.updated_at, locked: p.locked_for_user ? p.lock_explanation : null, canvas: ref.path };
    }
    if (ref.kind === "discussion_topics" || ref.kind === "announcements") {
      const d = await api(`${base}/discussion_topics/${ref.id}`);
      return { title: d.title, html: d.message, posted: d.posted_at, author: d.author && d.author.display_name,
        due: d.assignment && d.assignment.due_at, points: d.assignment && d.assignment.points_possible,
        type: d.assignment ? "discussion reply" : null, replies: d.discussion_subentry_count,
        locked: d.locked_for_user ? d.lock_explanation : null, canvas: ref.path };
    }
    if (ref.kind === "quizzes") {
      const q = await api(`${base}/quizzes/${ref.id}`);
      return { title: q.title, html: q.description, due: q.due_at, points: q.points_possible,
        type: [q.question_count && `${q.question_count} questions`, q.time_limit && `${q.time_limit} min`].filter(Boolean).join(", ") || "quiz",
        locked: q.locked_for_user ? q.lock_explanation : null, canvas: ref.path };
    }
    throw new Error("unsupported");
  }

  // Persistent cache, shared by all Canvas tabs; versioned by the item's updated_at when known.
  let disk = {};
  const diskReady = new Promise((res) => chrome.storage.local.get(["docs"], (d) => { disk = d.docs || {}; res(); }));
  let saveTimer = 0;
  function persist(path, version, doc) {
    disk[path] = { v: version || null, at: Date.now(), doc };
    const keys = Object.keys(disk);
    if (keys.length > MAX_CACHED) keys.sort((a, b) => disk[a].at - disk[b].at).slice(0, keys.length - MAX_CACHED).forEach((k) => delete disk[k]);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ docs: disk }), 400);
  }

  // Serve whatever is cached right away; refresh in the background if it's old.
  function get(ref, version) {
    if (!version && mem.has(ref.path)) return mem.get(ref.path);
    const p = diskReady.then(() => {
      const d = disk[ref.path];
      const age = d ? Date.now() - d.at : Infinity;
      const fresh = d && (version ? d.v === version : age < (d.v ? 6 * 3600e3 : 10 * 60e3));
      if (fresh) return d.doc;
      const net = fetchDoc(ref).then((doc) => {
        const changed = !d || JSON.stringify(d.doc) !== JSON.stringify(doc);
        persist(ref.path, version || (d && d.v), doc);
        if (changed && d && current && current.path === ref.path) paint(doc, true);
        return doc;
      });
      if (d && !version) { net.catch(() => {}); return d.doc; }
      return net;
    });
    p.catch(() => mem.delete(ref.path));
    mem.set(ref.path, p);
    return p;
  }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.docs && ch.docs.newValue) disk = ch.docs.newValue; });

  // ---------- view ----------
  const host = document.createElement("div");
  host.id = "quickstudy-reader";
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    :host([hidden]) { display: none; }
    .wrap { --paper:#FBFBFA; --rule:#EAEAEA; --ink:#2F3437; --ink-soft:#66655F; --ink-faint:#6F6E69; --accent:#1F6C9F;
      --danger:#9F2F2D; --good:#346538; --hold:#956400;
      --sans:'SF Pro Text','SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif; --mono:'SF Mono',ui-monospace,Menlo,monospace;
      position:fixed; inset:0 var(--right, 0px) 0 0; z-index:2147482999; background:var(--paper); color:var(--ink);
      overflow-y:auto; font:15px/1.6 var(--sans); -webkit-font-smoothing:antialiased; }
    @media (prefers-color-scheme: dark) { .wrap { --paper:#15161A; --rule:#2A2D34; --ink:#E6E4DF; --ink-soft:#9D9C96; --ink-faint:#94938B;
      --accent:#8CC2EC; --danger:#F0A9A0; --good:#A6CFA6; --hold:#E4C87F; } }
    .bar { position:sticky; top:0; display:flex; align-items:center; gap:16px; padding:12px 28px; background:var(--paper);
      border-bottom:1px solid var(--rule); font-size:13px; }
    .bar .sp { flex:1; }
    .bar button, .bar a { font:inherit; background:none; border:0; padding:0; cursor:pointer; color:var(--ink-soft); text-decoration:none; }
    .bar button:hover, .bar a:hover { color:var(--ink); }
    .bar .go { color:var(--accent); font-weight:500; }
    article { max-width:68ch; margin:0 auto; padding:36px 28px 80px; }
    h1 { font:600 24px/1.25 var(--sans); letter-spacing:-.015em; margin:0 0 8px; }
    .meta { font:12px/1.7 var(--mono); color:var(--ink-faint); margin-bottom:28px; }
    .meta .late, .meta .Missing { color:var(--danger); }
    .meta .ok { color:var(--good); }
    .lock { color:var(--hold); margin-bottom:20px; }
    .body { overflow-wrap:break-word; }
    .body img, .body video, .body iframe { max-width:100%; height:auto; }
    .body iframe { width:100%; min-height:420px; border:1px solid var(--rule); }
    .body a { color:var(--accent); }
    .body table { border-collapse:collapse; max-width:100%; display:block; overflow-x:auto; }
    .body td, .body th { border:1px solid var(--rule); padding:4px 8px; }
    .body p:first-child { margin-top:0; }
    .empty, .err { color:var(--ink-faint); }
  </style><div class="wrap"><div class="bar"><button class="back">← Back</button><span class="sp"></span>
    <a class="go" href="#">Open in Canvas</a></div><article></article></div>`;
  const wrap = shadow.querySelector(".wrap"), article = shadow.querySelector("article"), go = shadow.querySelector(".go");
  let pushed = false, current = null;

  const fmtDate = (s) => new Date(s).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // Rebuild teacher HTML from an allowlist into fresh elements: nothing from the source
  // document is reused, so no handler, script or odd attribute can come along.
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
      if (out.tagName === "A" && out.getAttribute("href") && new URL(out.href).origin !== location.origin) { out.target = "_blank"; out.rel = "noopener"; }
      if (out.tagName === "IMG" || out.tagName === "IFRAME") out.setAttribute("loading", "lazy");
      if (out.tagName === "IFRAME") out.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-forms allow-presentation");
      for (const c of node.childNodes) { const k = copy(c); if (k) out.append(k); }
      return out;
    };
    return [...src.childNodes].map(copy).filter(Boolean);
  }

  function paint(doc, keepScroll) {
    const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
    const meta = el("div", "meta");
    const bits = [];
    if (doc.due) bits.push([`Due ${fmtDate(doc.due)}`, new Date(doc.due) < new Date() && doc.status !== "Submitted" && !/^Graded|Excused/.test(doc.status || "") ? "late" : ""]);
    if (doc.points) bits.push([`${+doc.points} pts`]);
    if (doc.type) bits.push([doc.type]);
    if (doc.status) bits.push([doc.status, doc.status === "Missing" ? "Missing" : "ok"]);
    if (doc.author) bits.push([doc.author]);
    if (doc.posted && !doc.due) bits.push([fmtDate(doc.posted)]);
    if (doc.replies) bits.push([`${doc.replies} replies`]);
    bits.forEach(([t, c], i) => { if (i) meta.append(" · "); meta.append(el("span", c || "", t)); });
    const body = el("div", "body");
    const nodes = clean(doc.html);
    nodes.length ? body.append(...nodes) : body.append(el("p", "empty", "No description."));
    if (doc.title) document.title = `${doc.title} · Canvas`;
    article.replaceChildren(el("h1", "", doc.title || "Untitled"), meta, doc.locked ? el("p", "lock", doc.locked) : "", body);
    if (!keepScroll) wrap.scrollTop = 0;
  }

  function setRight() {
    wrap.style.setProperty("--right", document.documentElement.classList.contains("ctl-open") ? "300px" : "0px");
  }

  async function open(href, { push = true } = {}) {
    const ref = parse(href);
    if (!ref) return false;
    current = ref;
    if (!host.isConnected) (document.body || document.documentElement).append(host);
    setRight();
    go.href = ref.path;
    host.hidden = false;
    document.documentElement.style.overflow = "hidden";
    if (push) { history.pushState({ ctlReader: ref.path }, "", ref.path); pushed = true; }
    // Only show "Loading" if the data isn't already here, so cached opens never flash.
    let settled = false;
    const t = setTimeout(() => { if (!settled) article.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: "Loading…" })); }, 60);
    try {
      const doc = await get(ref);
      settled = true; clearTimeout(t);
      if (current === ref) paint(doc);
    } catch {
      settled = true; clearTimeout(t);
      if (current === ref) location.assign(ref.path); // fall back to the real page
    }
    return true;
  }

  function close() {
    host.hidden = true; current = null;
    document.documentElement.style.overflow = "";
  }

  const shell = () => !!window.__ctlShell;
  const back = () => (pushed ? history.back() : shell() ? location.assign("/") : close());
  shadow.querySelector(".back").addEventListener("click", back);
  go.addEventListener("click", (e) => { e.preventDefault(); location.assign(go.getAttribute("href")); });
  addEventListener("popstate", (e) => {
    if (e.state && e.state.ctlReader) open(e.state.ctlReader, { push: false });
    else if (!shell()) { close(); pushed = false; }
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !host.hidden && (pushed || !shell())) back(); });
  new MutationObserver(setRight).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  window.QuickstudyReader = { open: (href) => { if (!parse(href)) return false; open(href); return true; } };

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m && m.type === "ctl-open") reply(window.QuickstudyReader.open(m.url));
  });
  if (window.__ctlShell) {
    shadow.querySelector(".back").textContent = "← Dashboard";
    open(window.__ctlShell, { push: false });
  }

  // Intercept plain left-clicks on supported links (including inside the task panel and the reader).
  // The nearest link, unless a button inside it (like a task's checkbox) was the real target.
  const anchorFrom = (e) => {
    for (const n of e.composedPath()) {
      if (n.tagName === "BUTTON" || n.tagName === "INPUT") return null;
      if (n.tagName === "A" && n.href) return n;
    }
    return null;
  };
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = anchorFrom(e);
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a === go) return;
    if (!parse(a.href)) return;
    e.preventDefault();
    open(a.href);
  }, true);

  // Warm the cache on hover so the click itself is instant.
  let hoverTimer = 0;
  document.addEventListener("pointerover", (e) => {
    const a = anchorFrom(e);
    if (!a) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { const ref = parse(a.href); if (ref) get(ref).catch(() => {}); }, 70);
  }, true);

  // Prefetch the open tasks ahead of time, a couple at a time, only when they've changed.
  async function prefetchTasks(items) {
    const now = Date.now(), soon = now + 8 * 864e5;
    const todo = (items || []).filter((it) => {
      const done = it.planner_override ? it.planner_override.marked_complete : !!(it.submissions && (it.submissions.submitted || it.submissions.excused));
      const t = new Date(it.plannable_date).getTime();
      return !done && t < soon && it.plannable_type !== "announcement";
    }).slice(0, 30);
    await diskReady;
    const queue = todo.map((it) => ({ ref: parse(it.html_url), v: it.updated || null })).filter((x) => x.ref && !(disk[x.ref.path] && disk[x.ref.path].v === x.v && x.v));
    const worker = async () => { for (let x; (x = queue.shift());) await get(x.ref, x.v).catch(() => {}); };
    await Promise.all([worker(), worker()]);
  }
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  idle(() => chrome.storage.local.get(["items"], (d) => prefetchTasks(d.items)));
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.items) idle(() => prefetchTasks(ch.items.newValue)); });
})();
