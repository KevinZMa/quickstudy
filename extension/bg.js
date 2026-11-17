// Prefetches files into the shared cache.
importScripts("files.js");

let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((m) => {
  if (!m || m.type !== "prefetch") return;
  // Sequential, to avoid bursts.
  for (const src of (m.srcs || []).slice(0, 12)) queue = queue.then(() => self.QSFiles.load(src)).catch(() => {});
});
