// File loading shared by the viewer and the background worker. Both run on the extension origin,
// which allows the cross-origin redirect to Canvas file storage, and share one Cache.
self.QSFiles = (() => {
  const CACHE = "qs-files-v1", MAX_BYTES = 40e6, MAX_ITEMS = 60;
  const GDOC = /^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)/;

  // Canvas file or Google Docs/Slides/Sheets link -> download URL and metadata.
  async function resolve(src) {
    const g = src.match(GDOC);
    if (g) {
      const url = g[1] === "presentation" ? `https://docs.google.com/presentation/d/${g[2]}/export/pdf`
        : `https://docs.google.com/${g[1]}/d/${g[2]}/export?format=pdf`;
      return { url, meta: { name: null, type: "application/pdf", open: src, google: true } };
    }
    const u = new URL(src), id = (u.pathname.match(/\/files\/(\d+)/) || [])[1];
    try {
      const r = await fetch(`${u.origin}/api/v1/files/${id}`, { credentials: "include", headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        if (j.url) return { url: j.url, meta: { name: j.display_name, type: j["content-type"], size: j.size, open: src } };
      }
    } catch { /* fall through to the plain download link */ }
    return { url: `${u.origin}${u.pathname.replace(/\/(preview|download)\/?$/, "")}/download?download_frd=1`, meta: { name: null, type: null, open: src } };
  }

  const nameFrom = (cd) => {
    const m = (cd || "").match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
    return m ? decodeURIComponent(m[1] || m[2]) : null;
  };

  async function load(src) {
    const c = await caches.open(CACHE);
    const hit = await c.match(src);
    if (hit) return { blob: await hit.blob(), meta: JSON.parse(hit.headers.get("x-qs-meta")), cached: true };
    const { url, meta } = await resolve(src);
    if (meta.size > MAX_BYTES) throw Object.assign(new Error("too big"), { meta });
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw Object.assign(new Error(String(r.status)), { meta });
    const blob = await r.blob();
    meta.type = meta.type || (r.headers.get("content-type") || "").split(";")[0] || blob.type;
    meta.name = meta.name || nameFrom(r.headers.get("content-disposition")) || "File";
    // A non-PDF Google response is a sign-in or access-denied page.
    if (meta.google && !(blob.type || r.headers.get("content-type") || "").includes("pdf")) throw Object.assign(new Error("google"), { meta });
    if (blob.size <= MAX_BYTES) {
      await c.put(src, new Response(blob, { headers: { "x-qs-meta": JSON.stringify(meta) } }));
      const keys = await c.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ITEMS))) await c.delete(k);
    }
    return { blob, meta, cached: false };
  }

  return { load, GDOC };
})();
