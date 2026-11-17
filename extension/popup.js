// Toolbar popup: same list, available from any site.
// The Canvas origin is remembered the first time a Canvas page is opened with the extension installed.

// Open a task on Canvas itself:
//  - current tab is Canvas → the reader opens there, instantly, from cache;
//  - anywhere else → a new tab enters through the fast /robots.txt shell (see boot.js).
async function openTask(base, path) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.startsWith(base + "/")) {
    try {
      if (await chrome.tabs.sendMessage(tab.id, { type: "ctl-open", url: path })) return window.close();
    } catch { /* page still loading or content script missing: fall through */ }
    await chrome.tabs.update(tab.id, { url: base + path });
    return window.close();
  }
  await chrome.tabs.create({ url: `${base}/robots.txt#lite:${encodeURIComponent(path)}` });
  window.close();
}

chrome.storage.local.get(["origin"], ({ origin }) => {
  if (!origin) {
    document.body.textContent = "Open your Canvas site once, then come back here.";
    document.body.style.cssText = "font:13px -apple-system,sans-serif;padding:24px;color:#66655F";
    return;
  }
  window.Quickstudy.mount(document.body, {
    base: origin,
    getCsrf: async () => {
      const c = await chrome.cookies.get({ url: origin, name: "_csrf_token" });
      return c ? decodeURIComponent(c.value) : "";
    },
    onOpen: (url) => openTask(origin, new URL(url, origin).pathname),
  });
});
