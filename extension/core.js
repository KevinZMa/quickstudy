// Quickstudy — shared task list used by the on-page panel and the toolbar popup.
(() => {
  const PAST_DAYS = 7, FUTURE_DAYS = 21, STALE_MS = 5 * 60 * 1000, SOON_MS = 3 * 3600e3;
  const SKIP = new Set(["announcement", "calendar_event"]);
  // Each course gets one of six tones, derived from its id so it is the same everywhere.
  const TONES = ["purple", "green", "blue", "rust", "gold", "pink"];
  const toneFor = (id) => { let h = 0; for (const c of String(id || "x")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TONES[h % TONES.length]; };

  // Course colours the user picked in Canvas (Dashboard → card ⋮ → Color) win over the default tones.
  // Each is softened against the page so it reads well in light and dark mode:
  // a pale fill for backgrounds and arcs, and a deeper or lighter ink for text.
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

  /* Header: one line of status, one line of course filters. */
  .ctl header { flex:none; padding:12px 10px 8px 14px; }
  .ctl .bar { display:flex; align-items:center; gap:10px; height:28px; }
  .ctl .ring { flex:none; width:28px; height:28px; border-radius:50%; }
  .ctl .ring svg { width:28px; height:28px; transform:rotate(-90deg); display:block; }
  .ctl .ring:focus-visible { outline:2px solid var(--rule-strong); outline-offset:2px; }
  .ctl .stats { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--ink-soft); }
  .ctl .stats strong { color:var(--ink); font-weight:600; font-variant-numeric:tabular-nums; }
  .ctl .stats .late { color:var(--danger); }
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

  /* List: single-line rows, no dividers; day headers carry the structure. */
  .ctl main { overflow-y:auto; flex:1; padding:0 0 16px; border-top:1px solid var(--rule); }
  .ctl .day { display:flex; align-items:baseline; gap:6px; width:100%; text-align:left; padding:14px 14px 4px;
    position:sticky; top:0; background:var(--paper); z-index:1; }
  .ctl .day h2 { font:600 12px/16px var(--sans); color:var(--ink); }
  .ctl .day.overdue h2 { color:var(--danger); }
  .ctl .day .n { font:11px/16px var(--mono); color:var(--ink-faint); font-variant-numeric:tabular-nums; }
  .ctl .day.shut h2::after { content:" …"; color:var(--ink-faint); }
  .ctl .row { display:grid; grid-template-columns:32px minmax(0,1fr) auto; align-items:center; height:34px;
    padding-right:14px; text-decoration:none; color:inherit; }
  .ctl .row:hover { background:var(--sel); }
  /* The checkbox fills the gutter: a 32×34 target around a 16px ring tinted with the course colour. */
  .ctl .check { height:34px; display:grid; place-items:center; }
  .ctl .check i { width:16px; height:16px; border-radius:50%; border:1.5px solid var(--ti); opacity:.75; display:grid; place-items:center;
    font:700 10px/1 var(--sans); font-style:normal; color:transparent; transition:opacity 120ms, background 120ms; }
  .ctl .check:hover i { opacity:1; color:var(--ti); }
  .ctl .check:focus-visible i { outline:2px solid var(--rule-strong); outline-offset:2px; }
  .ctl .done .check i { background:var(--ti); border-color:var(--ti); color:var(--paper); opacity:.5; }
  .ctl .title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ctl .done .title { color:var(--ink-faint); }
  .ctl .acc { display:flex; align-items:baseline; gap:8px; padding-left:10px; font:11px/1 var(--mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ctl .code { font-weight:600; letter-spacing:.02em; color:var(--ti); }
  .ctl .when { color:var(--ink-faint); min-width:0; }
  .ctl .when.soon { color:var(--hold); }
  .ctl .when.late { color:var(--danger); }
  .ctl .empty { color:var(--ink-faint); padding:28px 14px; }
  .ctl .empty a { color:inherit; }`;

  const isDone = (it) => it.planner_override ? it.planner_override.marked_complete
    : !!(it.submissions && (it.submissions.submitted || it.submissions.excused));
  // Common Canvas naming noise: "[3] AP Biology S1 - Smith" -> "Biology".
  const shortCourse = (n) => String(n || "Personal").replace(/^\[[^\]]*\]\s*/, "").replace(/\s*-\s*[A-Z][a-z]+\s*$/, "")
    .replace(/\s+S[12]\b\s*/g, " ").replace(/\s+H\s*$/, "").replace(/^AP\s+/, "").trim();
  const shortName = (n) => { let s = shortCourse(n); if (s.length > 17) s = s.slice(0, 17).replace(/\s+\S*$/, ""); return s.replace(/[\s&:,.-]+$/, ""); };
  // Linear-style course keys: an acronym stays whole (ESL), a word gives its first four letters (BIOL).
  const courseCode = (n) => {
    const w = (shortCourse(n).split(/\s+/)[0] || "").replace(/[^A-Za-z0-9]/g, "");
    return (/^[A-Z0-9]{2,5}$/.test(w) ? w : w.slice(0, 4)).toUpperCase() || "—";
  };
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const isEndOfDay = (d) => d.getHours() === 23 && d.getMinutes() >= 59;

  // Compact times: "8:59a", "11:59p". Canvas's default 11:59 PM is implied and left out.
  const clock = (d) => { let h = d.getHours(), m = d.getMinutes(); const ap = h < 12 ? "a" : "p"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")}${ap}`; };
  function when(d, now, section) {
    const ms = d - now;
    if (ms < 0) {
      const h = -ms / 3600e3;
      return h < 24 ? `${Math.max(1, Math.round(h))}h late` : `${Math.round(h / 24)}d late`;
    }
    if (ms < SOON_MS) { const m = Math.round(ms / 60e3); return m < 60 ? `in ${m}m` : `in ${Math.round(m / 60)}h`; }
    const t = isEndOfDay(d) ? "" : clock(d);
    if (section === "Today" || section === "Tomorrow") return t;
    if (section === "Next 7 days") return d.toLocaleDateString(undefined, { weekday: "short" }) + (t ? ` ${t}` : "");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    let items = [], showDone = false, scope = "week", filter = null, shut = new Set();

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

    // Ring: one arc per course; its share is that course's work, the dark part is what's done.
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
      const late = open.filter((it) => new Date(it.plannable_date) < now).length;
      stats.replaceChildren(
        el("strong", { textContent: `${done}/${total}` }), scope === "today" ? " today" : " this week",
        late ? el("span", { className: "late", textContent: ` · ${late} late` }) : null);
      if (onCount) onCount(open.length);

      // Course filters: code + open count, one line. Doubles as the ring's legend.
      const counts = new Map();
      for (const it of open) counts.set(key(it), { it, n: (counts.get(key(it))?.n || 0) + 1 });
      filters.classList.toggle("active", filter != null);
      filters.replaceChildren(...[...counts].sort((a, b) => b[1].n - a[1].n).map(([k, { it, n }]) => {
        const b = tint(el("button", { className: "f" + (filter === k ? " on" : ""), title: it.context_name || "" },
          courseCode(it.context_name), el("span", { textContent: n })), k);
        b.addEventListener("click", () => { filter = filter === k ? null : k; render(); });
        return b;
      }));

      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
      const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
      const sectionOf = (it) => {
        const d = new Date(it.plannable_date);
        if (isDone(it)) return "Done";
        if (d < now) return "Overdue";
        if (d < tomorrow) return "Today";
        if (startOfDay(d).getTime() === tomorrow.getTime()) return "Tomorrow";
        if (d < weekEnd) return "Next 7 days";
        return "Later";
      };
      const ORDER = ["Overdue", "Today", "Tomorrow", "Next 7 days", "Later", "Done"];
      const groups = Object.fromEntries(ORDER.map((k) => [k, []]));
      for (const it of tasks()) {
        if (filter != null && key(it) !== filter) continue;
        if (isDone(it) && !showDone) continue;
        groups[sectionOf(it)].push(it);
      }
      for (const k of ORDER) groups[k].sort((a, b) => new Date(a.plannable_date) - new Date(b.plannable_date));
      groups.Done.reverse();

      const frag = document.createDocumentFragment();
      for (const k of ORDER) {
        const g = groups[k];
        if (!g.length) continue;
        const head = el("button", { className: "day" + (k === "Overdue" ? " overdue" : "") + (shut.has(k) ? " shut" : ""),
          title: shut.has(k) ? "Show" : "Collapse" }, el("h2", { textContent: k }), el("span", { className: "n", textContent: g.length }));
        head.addEventListener("click", () => { shut.has(k) ? shut.delete(k) : shut.add(k); chrome.storage.local.set({ shut: [...shut] }); render(); });
        frag.append(head);
        if (!shut.has(k)) for (const it of g) frag.append(row(it, now, k));
      }
      list.replaceChildren(frag.childNodes.length ? frag : el("p", { className: "empty", textContent: "Nothing open." }));
    }

    function row(it, now, section) {
      const d = new Date(it.plannable_date), done = isDone(it);
      const late = !done && d < now, soon = !done && !late && d - now < SOON_MS;
      const missing = !done && it.submissions && it.submissions.missing;
      const check = el("button", { className: "check", title: done ? "Mark incomplete" : "Mark complete" }, el("i", { textContent: "✓" }));
      check.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(it); });
      const text = section === "Done" ? when(d, now, "Later") : missing ? "missing" : when(d, now, section);
      const full = d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const title = it.plannable.title || "Untitled";
      const a = tint(el("a", { className: "row" + (done ? " done" : ""), href: BASE + it.html_url,
        title: `${title}\n${it.context_name || ""}\nDue ${full}${it.points ? ` · ${+it.points} pts` : ""}` },
        check,
        el("span", { className: "title", textContent: title }),
        el("span", { className: "acc" },
          filter == null ? el("span", { className: "code", textContent: courseCode(it.context_name) }) : null,
          text ? el("span", { className: "when" + (late || missing ? " late" : soon ? " soon" : ""), textContent: text }) : null)), key(it));
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
        // Keep only what we render, so the cache stays tiny.
        items = all.map(({ plannable_id, plannable_type, plannable_date, html_url, context_name, course_id, submissions, planner_override, plannable }) => ({
          plannable_id, plannable_type, plannable_date, html_url, context_name, course_id,
          submissions: submissions ? { submitted: submissions.submitted, excused: submissions.excused, missing: submissions.missing } : false,
          planner_override: planner_override ? { id: planner_override.id, marked_complete: planner_override.marked_complete } : null,
          plannable: { title: plannable && (plannable.title || plannable.name) },
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

    // Keep every open Canvas tab + the popup in sync without extra requests.
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch.items && ch.items.newValue) { items = ch.items.newValue; render(); }
    });

    // Paint from cache instantly; only hit the network if the cache is stale.
    const refreshIfStale = () => chrome.storage.local.get(["at"], (d) => { if (!d.at || Date.now() - d.at > STALE_MS) load(); });
    chrome.storage.local.get(["items", "scope", "shut"], (d) => {
      if (d.scope) scope = d.scope;
      shut = new Set(d.shut || []);
      if (d.items) { items = d.items; render(); }
      refreshIfStale();
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshIfStale(); });
    return { refresh: load };
  }

  window.Quickstudy = { mount, shortName, courseCode, toneFor, colorFor, paint, onColors: (f) => colorListeners.add(f), clock, isEndOfDay, CSS_TOKENS: TOKENS };
})();
