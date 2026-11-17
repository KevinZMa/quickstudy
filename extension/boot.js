// Entry point for tasks opened from the toolbar popup. The popup loads /robots.txt#lite:<path>,
// which Canvas serves faster than a full page; this script sets the real path and the reader
// renders it from cache. Reloading loads the full Canvas page.
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
