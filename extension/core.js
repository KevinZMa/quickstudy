// Task list shared by the on-page panel and the toolbar popup.
(() => {
  const PAST_DAYS = 7, FUTURE_DAYS = 21, STALE_MS = 5 * 60 * 1000, SOON_MS = 6 * 3600e3;
  const SKIP = new Set(["announcement", "calendar_event"]);
  // Default course tone, derived from the course id.
  const TONES = ["purple", "green", "blue", "rust", "gold", "pink"];
  const toneFor = (id) => { let h = 0; for (const c of String(id || "x")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TONES[h % TONES.length]; };

  // Course colors set in Canvas override the default tones, mixed with the page color for contrast.
  let custom = {};
  const colorListeners = new Set();
  const COLORS_TTL = 24 * 3600e3;
  const isHex = (v) => /^#[0-9a-f]{3,8}$/i.test(v || "");
  function colorFor(id) {
    const hex = custom[String(id)];
    if (isHex(hex)) return { bg: `color-mix(in srgb, ${hex} 18%, var(--paper))`, ink: `color-mix(in srgb, ${hex} 72%, var(--ink))` };
    const t = toneFor(id);
    return { bg: `var(--${t})`, ink: `var(--${t}-i)` };
  }
  const paint = (node, id) => { const c = colorFor(id); node.style.setProperty("--t", c.bg); node.style.setProperty("--ti", c.ink); return node; };
  function applyColors(map) { custom = map || {}; colorListeners.forEach((f) => f()); }
  function loadColors(base) {
    chrome.storage.local.get(["colors"], ({ colors }) => {
      if (colors) applyColors(colors.map);
      if (colors && Date.now() - colors.at < COLORS_TTL) return;
      fetch(`${base}/api/v1/users/self/colors`, { credentials: "include", headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || !j.custom_colors) return;
          const map = {};
          for (const [k, v] of Object.entries(j.custom_colors)) { const m = k.match(/^course_(\d+)$/); if (m && isHex(v)) map[m[1]] = v; }
          chrome.storage.local.set({ colors: { at: Date.now(), map } });
        }).catch(() => {});
    });
  }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.colors && ch.colors.newValue) applyColors(ch.colors.newValue.map); });

  const TOKENS = `
  .ctl { --paper:#FBFBFA; --rule:#EAEAEA; --rule-strong:#DCDBD7; --ink:#2F3437; --ink-soft:#66655F; --ink-faint:#6F6E69;
    --danger:#9F2F2D; --danger-bg:#FDEBEC; --hold:#956400; --sel:#F1F0ED; --accent:#1F6C9F;
    --purple:#EFEAF6; --purple-i:#57457C; --green:#EAF2E9; --green-i:#2F5F34; --blue:#E1F3FE; --blue-i:#1B6394;
    --rust:#FCEBE4; --rust-i:#9B4620; --gold:#FBF3DB; --gold-i:#7E5400; --pink:#FBE9F1; --pink-i:#8E3465;
    --sans:'SF Pro Text','SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;
    --mono:'SF Mono',ui-monospace,Menlo,monospace;
    color:var(--ink); font:13px/1.4 var(--sans); -webkit-font-smoothing:antialiased; }
  @media (prefers-color-scheme: dark) { .ctl {
    --paper:#15161A; --rule:#2A2D34; --rule-strong:#3A3E47; --ink:#E6E4DF; --ink-soft:#9D9C96; --ink-faint:#94938B;
    --danger:#F0A9A0; --danger-bg:#3A211F; --hold:#E4C87F; --sel:#23262C; --accent:#8CC2EC;
    --purple:#272138; --purple-i:#BCA9DE; --green:#1E2C1F; --green-i:#A6CFA6; --blue:#17303F; --blue-i:#8CC2EC;
    --rust:#38211A; --rust-i:#EFA381; --gold:#332A17; --gold-i:#E4C87F; --pink:#37202C; --pink-i:#EBA3C4; } }
  .ctl * { box-sizing:border-box; margin:0; }
  .ctl button { font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer; }`;

  const CSS = TOKENS + `
  .ctl.panel { background:var(--paper); display:flex; flex-direction:column; height:100%; }

  .ctl header { flex:none; padding:12px 10px 8px 14px; }
  .ctl .bar { display:flex; align-items:center; gap:10px; height:28px; }
  .ctl .ring { flex:none; width:28px; height:28px; border-radius:50%; }
  .ctl .ring svg { width:28px; height:28px; transform:rotate(-90deg); display:block; }
  .ctl .ring:focus-visible { outline:2px solid var(--rule-strong); outline-offset:2px; }
  .ctl .stats { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--ink-soft); }
  .ctl .stats strong { color:var(--ink); font-weight:600; font-variant-numeric:tabular-nums; }
  .ctl .stats .late { color:var(--ink); font-weight:600; }
  .ctl .ib { width:28px; height:28px; border-radius:6px; display:grid; place-items:center; color:var(--ink-faint); font-size:14px; }
  .ctl .ib:hover { background:var(--sel); color:var(--ink); }
  .ctl .ib.on { color:var(--ink); background:var(--sel); }
  .ctl .filters { display:flex; gap:2px; margin:6px -4px 0; overflow-x:auto; scrollbar-width:none; }
  .ctl .filters::-webkit-scrollbar { display:none; }
  .ctl .f { flex:none; display:flex; align-items:baseline; gap:4px; padding:2px 6px; border-radius:5px;
    font:600 11px/18px var(--mono); letter-spacing:.02em; color:var(--ti); }
  .ctl .f span { font-weight:400; color:var(--ink-faint); }
  .ctl .f:hover { background:var(--sel); }
  .ctl .f.on { background:var(--t); }
  .ctl .filters.active .f:not(.on) { opacity:.45; }

  /* Timeline: day label, course-colored ring, title, right-side text. */
  .ctl main { overflow-y:auto; flex:1; padding:6px 0 16px; border-top:1px solid var(--rule); }
  .ctl .row, .ctl .gap { display:grid; grid-template-columns:46px 24px minmax(0,1fr) auto; align-items:center; height:32px;
    padding-right:14px; text-decoration:none; color:inherit; }
  .ctl .gap { height:18px; }
  .ctl .first:not(:first-child) { margin-top:6px; }
  .ctl .row:hover { background:var(--sel); }
  .ctl .lbl { padding-left:11px; font:500 11px/1 var(--sans); color:var(--ink-soft); white-space:nowrap; overflow:visible; }
  .ctl .gap .lbl { color:var(--ink-faint); font-weight:400; }
  .ctl .check, .ctl .node { position:relative; height:100%; display:grid; place-items:center; }
  .ctl .check::before, .ctl .node::before { content:""; position:absolute; left:50%; top:0; bottom:0; border-left:1px solid var(--rule); }
  .ctl .node b { position:relative; width:4px; height:4px; border-radius:50%; background:var(--rule-strong); }
  .ctl .now { display:grid; grid-template-columns:46px 1fr; align-items:center; height:16px; margin-top:4px; padding-right:14px; }
  .ctl .now .lbl { font:10px/1 var(--mono); color:var(--ink-faint); }
  .ctl .now i { height:1px; background:var(--rule-strong); }
  /* Dashed ring: nothing to upload. */
  .ctl .check i { position:relative; width:16px; height:16px; border-radius:50%; border:1.5px solid var(--ti); background:var(--paper);
    display:grid; place-items:center; font:700 10px/1 var(--sans); font-style:normal; color:transparent; transition:background 120ms; }
  .ctl .row:hover .check i { background:var(--sel); }
  .ctl .noup .check i { border-style:dashed; }
  .ctl .check:hover i { color:var(--ti); }
  .ctl .check:focus-visible i { outline:2px solid var(--rule-strong); outline-offset:2px; }
  .ctl .done .check i { background:var(--ti); border-color:var(--ti); border-style:solid; color:var(--paper); opacity:.5; }
  .ctl .title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-left:6px; }
  .ctl .noup .title, .ctl .done .title { color:var(--ink-faint); }
  .ctl .acc { display:flex; align-items:center; gap:7px; padding-left:10px; font:11px/1 var(--mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ctl .code { font-weight:600; letter-spacing:.02em; color:var(--ti); }
  .ctl .when { color:var(--ink-faint); min-width:0; }
  .ctl .when.soon, .ctl .when.flagged { color:var(--ink); }
  .ctl .flag { display:inline-grid; place-items:center; width:13px; height:13px; border-radius:50%; background:var(--ink); color:var(--paper);
    font:700 9px/1 var(--sans); }
  .ctl .fb { width:12px; height:12px; fill:none; stroke:var(--ink-soft); stroke-width:1.3; stroke-linejoin:round; }
  .ctl .donehead { padding:16px 14px 4px; font:600 12px/16px var(--sans); color:var(--ink); }
  .ctl .empty { color:var(--ink-faint); padding:28px 14px; }
  .ctl .empty a { color:inherit; }`;

  const isDone = (it) => it.planner_override ? !!it.planner_override.marked_complete
    : !!(it.submissions && (it.submissions.submitted || it.submissions.excused || it.submissions.graded));

  // True for items with no assignment or only non-upload submission types. The planner rarely
  // includes submission types, so they are looked up in the search index; unknown means upload.
  const NO_UPLOAD = new Set(["none", "on_paper", "not_graded"]);
  let uploadTypes = new Map();
  const pathOf = (u) => { try { return new URL(u, "https://x.invalid").pathname; } catch { return String(u); } };
  function setIndex(index) {
    uploadTypes = new Map();
    for (const it of (index && index.items) || []) if (it.submission_types) uploadTypes.set(it.url, it.submission_types);
    colorListeners.forEach((f) => f());
  }
  chrome.storage.local.get(["index"], ({ index }) => setIndex(index));
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.index && ch.index.newValue) setIndex(ch.index.newValue); });
  function noUpload(it) {
    if (!it.submissions) return true;
    const types = (it.plannable && it.plannable.submission_types) || uploadTypes.get(pathOf(it.html_url));
    return !!(types && types.length && types.every((t) => NO_UPLOAD.has(t)));
  }
  // "[3] AP Biology S1 - Smith" -> "Biology".
  const shortCourse = (n) => String(n || "Personal").replace(/^\[[^\]]*\]\s*/, "").replace(/\s*-\s*[A-Z][a-z]+\s*$/, "")
    .replace(/\s+S[12]\b\s*/g, " ").replace(/\s+H\s*$/, "").replace(/^AP\s+/, "").trim();
  const shortName = (n) => { let s = shortCourse(n); if (s.length > 17) s = s.slice(0, 17).replace(/\s+\S*$/, ""); return s.replace(/[\s&:,.-]+$/, ""); };
  // Course code: an acronym as is (ESL), otherwise the first four letters (BIOL).
  const courseCode = (n) => {
    const w = (shortCourse(n).split(/\s+/)[0] || "").replace(/[^A-Za-z0-9]/g, "");
    return (/^[A-Z0-9]{2,5}$/.test(w) ? w : w.slice(0, 4)).toUpperCase() || "—";
  };
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const isEndOfDay = (d) => d.getHours() === 23 && d.getMinutes() >= 59;

  // "8:59a", "11:59p".
  const clock = (d) => { let h = d.getHours(), m = d.getMinutes(); const ap = h < 12 ? "a" : "p"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")}${ap}`; };
  const whole = (x) => Math.max(1, Math.round(x));
  const span = (h) => (h < 24 ? `${whole(h)}h` : `${whole(h / 24)}d`);

  // Right-side text of an open row.
  function rightText(it, now) {
    const d = new Date(it.plannable_date), ms = d - now;
    if (ms < 0) return noUpload(it) ? { text: `${span(-ms / 3600e3)} ago` } : { text: `${span(-ms / 3600e3)} late`, flag: true };
    if (it.submissions && it.submissions.missing) return { text: "missing", flag: true };
    if (ms < SOON_MS) { const m = ms / 60e3; return { text: m < 60 ? `in ${whole(m)}m` : `in ${whole(m / 60)}h`, cls: "soon" }; }
    return { text: isEndOfDay(d) ? "" : clock(d) };
  }

  // Right-side text of a done row. `sub` (submission time and score) loads separately and may be missing.
  const dur = (sec) => { const m = sec / 60; return m < 60 ? `${whole(m)}m` : span(m / 60); };
  function short(d) {
    const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 864e5);
    return days >= 0 && days < 7 ? `${d.toLocaleDateString(undefined, { weekday: "short" })} ${clock(d)}` : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function doneText(it, sub) {
    const s = it.submissions || {};
    if (s.excused) return "excused";
    if (sub && sub.workflow_state === "graded" && sub.score != null) return it.points ? `${+sub.score}/${+it.points}` : `${+sub.score}`;
    if (s.submitted) {
      if (sub && sub.submitted_at) return sub.late ? (sub.seconds_late ? `submitted ${dur(sub.seconds_late)} late` : "submitted late") : `submitted ${short(new Date(sub.submitted_at))}`;
      return s.late ? "submitted late" : "submitted";
    }
    if (s.graded) return "graded";
    if (it.planner_override && it.planner_override.marked_complete) return "dismissed";
    return "";
  }

  function el(tag, props = {}, ...kids) {
    const e = Object.assign(document.createElement(tag), props);
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }
  const svg = (tag, attrs) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  function arc(cx, cy, r, a0, a1) {
    const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const tint = paint;

  // base: the Canvas origin, e.g. "https://school.instructure.com".
  function mount(root, { base: BASE, getCsrf, extraHeader, onCount, onOpen } = {}) {
    let items = [], showDone = false, scope = "week", filter = null;
    const subs = new Map(), askedSubs = new Set();

    const style = el("style", { textContent: CSS });
    const ring = el("button", { className: "ring" });
    const stats = el("div", { className: "stats" });
    const doneBtn = el("button", { className: "ib", title: "Show completed", textContent: "✓" });
    const filters = el("div", { className: "filters" });
    const list = el("main", {}, el("p", { className: "empty", textContent: "Loading…" }));
    const shell = el("div", { className: "ctl panel" },
      el("header", {}, el("div", { className: "bar" }, ring, stats, doneBtn, extraHeader || null), filters),
      list);
    root.append(style, shell);

    const tasks = () => items.filter((it) => !SKIP.has(it.plannable_type));
    const key = (it) => String(it.course_id || "x");

    // Progress ring: one arc per course, filled in proportion to completed work.
    function drawRing(now) {
      const today = startOfDay(now), monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const start = scope === "today" ? today : monday;
      const end = new Date(start); end.setDate(start.getDate() + (scope === "today" ? 1 : 7));
      const inScope = tasks().filter((it) => { const d = new Date(it.plannable_date); return d >= start && d < end; });
      const groups = new Map();
      for (const it of inScope) {
        const g = groups.get(key(it)) || { id: key(it), total: 0, done: 0 };
        g.total++; if (isDone(it)) g.done++; groups.set(key(it), g);
      }
      const total = inScope.length, done = inScope.filter(isDone).length;
      const s = svg("svg", { viewBox: "0 0 28 28" });
      const R = 11.5, W = 4, GAP = groups.size > 1 ? 0.14 : 0, FULL = Math.PI * 2 - 1e-4;
      s.append(svg("circle", { cx: 14, cy: 14, r: R, fill: "none", style: "stroke:var(--rule)", "stroke-width": W }));
      let a = 0;
      for (const g of groups.values()) {
        const span = (g.total / total) * Math.PI * 2;
        const a0 = a + GAP / 2, a1 = Math.min(a + span - GAP / 2, FULL), mid = a0 + (a1 - a0) * (g.done / g.total);
        const c = colorFor(g.id), op = filter != null && filter !== g.id ? ";opacity:.25" : "";
        if (a1 > a0) s.append(svg("path", { d: arc(14, 14, R, a0, a1), fill: "none", style: `stroke:${c.bg}${op}`, "stroke-width": W }));
        if (g.done) s.append(svg("path", { d: arc(14, 14, R, a0, Math.min(mid, FULL)), fill: "none", style: `stroke:${c.ink}${op}`, "stroke-width": W }));
        a += span;
      }
      ring.replaceChildren(s);
      ring.title = `${done} of ${total} done ${scope === "today" ? "today" : "this week"}. Click for ${scope === "today" ? "the week" : "today"}.`;
      return { done, total };
    }

    function render() {
      const now = new Date(), today = startOfDay(now);
      const { done, total } = drawRing(now);
      const open = tasks().filter((it) => !isDone(it));
      const late = open.filter((it) => new Date(it.plannable_date) < now && !noUpload(it)).length;
      stats.replaceChildren(
        el("strong", { textContent: `${done}/${total}` }), scope === "today" ? " today" : " this week",
        late ? el("span", { className: "late", textContent: ` · ${late} late` }) : null);
      if (onCount) onCount(open.length);

      const counts = new Map();
      for (const it of open) counts.set(key(it), { it, n: (counts.get(key(it))?.n || 0) + 1 });
      filters.classList.toggle("active", filter != null);
      filters.replaceChildren(...[...counts].sort((a, b) => b[1].n - a[1].n).map(([k, { it, n }]) => {
        const b = tint(el("button", { className: "f" + (filter === k ? " on" : ""), title: it.context_name || "" },
          courseCode(it.context_name), el("span", { textContent: n })), k);
        b.addEventListener("click", () => { filter = filter === k ? null : k; render(); });
        return b;
      }));

      const vis = tasks().filter((it) => filter == null || key(it) === filter);
      const at = (it) => new Date(it.plannable_date);
      const openV = vis.filter((it) => !isDone(it)).sort((a, b) => at(a) - at(b));
      const frag = document.createDocumentFragment();
      const group = (label, list) => list.forEach((it, i) => frag.append(row(it, now, i ? "" : label, !i)));

      const past = openV.filter((it) => at(it) < now), future = openV.filter((it) => at(it) >= now);
      if (past.length) {
        group("Late", past);
        frag.append(el("div", { className: "now" }, el("span", { className: "lbl", textContent: "now" }), el("i")));
      }
      if (openV.length) {
        const days = new Map(), later = new Map();
        for (const it of future) {
          const day0 = startOfDay(at(it)), n = Math.round((day0 - today) / 864e5);
          const m = n < 7 ? days : later, k = n < 7 ? n : day0.getTime();
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(it);
        }
        for (let n = 0; n < 7; n++) {
          const d = new Date(today); d.setDate(today.getDate() + n);
          const label = n === 0 ? "Today" : n === 1 ? "Tmrw" : d.toLocaleDateString(undefined, { weekday: "short" });
          if (days.has(n)) group(label, days.get(n));
          else frag.append(el("div", { className: "gap first", title: d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) },
            el("span", { className: "lbl", textContent: label }), el("span", { className: "node" }, el("b"))));
        }
        for (const [t, list] of later) group(new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }), list);
      }
      if (showDone) {
        const doneV = vis.filter(isDone).sort((a, b) => at(b) - at(a));
        if (doneV.length) {
          frag.append(el("div", { className: "donehead", textContent: "Done" }));
          for (const it of doneV) frag.append(row(it, now, "", false));
          loadSubs(doneV);
        }
      }
      list.replaceChildren(openV.length || frag.childNodes.length ? frag : el("p", { className: "empty", textContent: "Nothing open." }));
    }

    const subKey = (it) => String((it.plannable && it.plannable.assignment_id) || (it.plannable_type === "assignment" ? it.plannable_id : ""));
    // Submission details for done rows, one request per course.
    function loadSubs(done) {
      const byCourse = new Map();
      for (const it of done) {
        const aid = subKey(it);
        if (!aid || askedSubs.has(aid)) continue;
        askedSubs.add(aid);
        const cid = String(it.course_id);
        if (!byCourse.has(cid)) byCourse.set(cid, []);
        byCourse.get(cid).push(aid);
      }
      for (const [cid, ids] of byCourse) {
        api(`/api/v1/courses/${cid}/students/submissions?per_page=100&${ids.map((a) => `assignment_ids[]=${a}`).join("&")}`)
          .then((r) => r.json())
          .then((list) => { for (const x of list) subs.set(String(x.assignment_id), x); render(); })
          .catch(() => {});
      }
    }

    function row(it, now, label, first) {
      const d = new Date(it.plannable_date), done = isDone(it), nu = !done && noUpload(it);
      const check = el("button", { className: "check", title: done ? "Mark incomplete" : "Mark complete" }, el("i", { textContent: "✓" }));
      check.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(it); });
      const r = done ? { text: doneText(it, subs.get(subKey(it))) } : rightText(it, now);
      const full = d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const title = it.plannable.title || "Untitled";
      let fb = null;
      if (done && it.submissions && it.submissions.feedback) {
        fb = svg("svg", { viewBox: "0 0 12 12", class: "fb" });
        const t = svg("title", {}); t.textContent = "New feedback";
        fb.append(t, svg("path", { d: "M1.5 2h9v6h-5l-2.5 2V8h-1.5z" }));
      }
      const a = tint(el("a", { className: "row" + (first ? " first" : "") + (done ? " done" : "") + (nu ? " noup" : ""), href: BASE + it.html_url,
        title: `${title}\n${it.context_name || ""}\nDue ${full}${it.points ? ` · ${+it.points} pts` : ""}${nu ? "\nNothing to upload" : ""}` },
        el("span", { className: "lbl", textContent: label }),
        check,
        el("span", { className: "title", textContent: title }),
        el("span", { className: "acc" },
          filter == null && !done ? el("span", { className: "code", textContent: courseCode(it.context_name) }) : null,
          fb,
          r.flag ? el("span", { className: "flag", textContent: "!", title: "Missing" }) : null,
          r.text ? el("span", { className: "when" + (r.cls ? ` ${r.cls}` : "") + (r.flag ? " flagged" : ""), textContent: r.text }) : null)), key(it));
      if (onOpen) a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault(); onOpen(it.html_url);
      });
      return a;
    }

    async function api(path, opts = {}) {
      const r = await fetch(BASE + path, { credentials: "include", ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) } });
      if (r.status === 401) throw new Error("auth");
      if (!r.ok) throw new Error(String(r.status));
      return r;
    }

    async function load() {
      try {
        const start = new Date(Date.now() - PAST_DAYS * 864e5).toISOString();
        const end = new Date(Date.now() + FUTURE_DAYS * 864e5).toISOString();
        let url = `/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=100`, all = [];
        for (let i = 0; url && i < 5; i++) {
          const r = await api(url);
          all = all.concat(await r.json());
          const next = (r.headers.get("link") || "").match(/<([^>]+)>;\s*rel="next"/);
          url = next ? next[1].replace(BASE, "") : null;
        }
        // Keep only rendered fields.
        items = all.map(({ plannable_id, plannable_type, plannable_date, html_url, context_name, course_id, submissions, planner_override, plannable }) => ({
          plannable_id, plannable_type, plannable_date, html_url, context_name, course_id,
          submissions: submissions ? { submitted: submissions.submitted, excused: submissions.excused, graded: submissions.graded,
            late: submissions.late, missing: submissions.missing, feedback: !!(submissions.with_feedback ?? submissions.has_feedback) } : false,
          planner_override: planner_override ? { id: planner_override.id, marked_complete: planner_override.marked_complete } : null,
          plannable: { title: plannable && (plannable.title || plannable.name), assignment_id: plannable && plannable.assignment_id,
            submission_types: plannable && plannable.submission_types },
          points: plannable && plannable.points_possible,
          updated: plannable && plannable.updated_at,
        }));
        await chrome.storage.local.set({ items, at: Date.now() });
        render();
      } catch (e) {
        if (!items.length) {
          list.replaceChildren(e.message === "auth"
            ? el("p", { className: "empty" }, "Sign in to ", el("a", { href: BASE, textContent: "Canvas" }), " first.")
            : el("p", { className: "empty", textContent: "Couldn't reach Canvas." }));
        }
      }
    }

    async function toggle(it) {
      const next = !isDone(it), prev = it.planner_override;
      it.planner_override = { ...(prev || {}), marked_complete: next };
      render();
      try {
        const headers = { "Content-Type": "application/json", "X-CSRF-Token": (await getCsrf()) || "" };
        const r = prev && prev.id
          ? await api(`/api/v1/planner/overrides/${prev.id}`, { method: "PUT", headers, body: JSON.stringify({ marked_complete: next }) })
          : await api(`/api/v1/planner/overrides`, { method: "POST", headers,
              body: JSON.stringify({ plannable_type: it.plannable_type, plannable_id: it.plannable_id, marked_complete: next }) });
        const o = await r.json();
        it.planner_override = { id: o.id, marked_complete: o.marked_complete };
        await chrome.storage.local.set({ items });
      } catch { it.planner_override = prev; render(); }
    }

    doneBtn.addEventListener("click", () => { showDone = !showDone; doneBtn.classList.toggle("on", showDone); doneBtn.title = showDone ? "Hide completed" : "Show completed"; render(); });
    ring.addEventListener("click", () => { scope = scope === "week" ? "today" : "week"; chrome.storage.local.set({ scope }); render(); });

    colorListeners.add(() => { if (items.length) render(); });
    loadColors(BASE);

    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch.items && ch.items.newValue) { items = ch.items.newValue; render(); }
    });

    // Render from cache, then refresh if stale.
    const refreshIfStale = () => chrome.storage.local.get(["at"], (d) => { if (!d.at || Date.now() - d.at > STALE_MS) load(); });
    chrome.storage.local.get(["items", "scope"], (d) => {
      if (d.scope) scope = d.scope;
      if (d.items) { items = d.items; render(); }
      refreshIfStale();
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshIfStale(); });
    return { refresh: load };
  }

  window.Quickstudy = { mount, isDone, noUpload, shortName, courseCode, toneFor, colorFor, paint, onColors: (f) => colorListeners.add(f), clock, isEndOfDay, CSS_TOKENS: TOKENS };
})();
