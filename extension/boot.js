// Fast entry for links opened from outside Canvas (the toolbar popup).
// The popup opens /robots.txt#lite:/courses/... — Canvas answers that in ~0.1 s instead of ~1 s
// for a full page. Here we swap the address to the real path and let the reader draw it from
// cache. Reloading the tab then loads the real Canvas page, so nothing is ever a dead end.
(() => {
  if (window.top !== window || location.pathname !== "/robots.txt" || !location.hash.startsWith("#lite:")) return;
  const target = decodeURIComponent(location.hash.slice(6));
  if (!/^\/courses\/\d+\//.test(target)) return;
  history.replaceState({ ctlReader: target }, "", target);
  window.__ctlShell = target;
  const s = document.createElement("style");
  s.textContent = `html,body{margin:0;background:#FBFBFA}@media (prefers-color-scheme:dark){html,body{background:#15161A}}body>pre{display:none}`;
  document.documentElement.append(s);
  document.addEventListener("DOMContentLoaded", () => document.body.replaceChildren(), { once: true });
})();
