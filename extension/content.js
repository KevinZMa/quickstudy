// Docked task panel on every Canvas page. Runs after the page has loaded (document_idle).
(() => {
  if (window.top !== window || document.getElementById("quickstudy-host")) return;
  const W = 300;

  // Page-level layout tweak: make room for the panel when it's open.
  const pageStyle = document.createElement("style");
  pageStyle.textContent = `html.ctl-open body { margin-right: ${W}px !important; }`;
  document.head.append(pageStyle);

  const host = document.createElement("div");
  host.id = "quickstudy-host";
  host.style.cssText = `position:fixed;top:0;right:0;height:100vh;z-index:2147483000;`;
  const shadow = host.attachShadow({ mode: "open" });

  const frame = document.createElement("style");
  frame.textContent = `
    .panel { width:${W}px; height:100vh; border-left:1px solid #EAEAEA; }
    .tab { position:fixed; right:0; top:50%; transform:translateY(-50%); cursor:pointer; writing-mode:vertical-rl;
      background:#FBFBFA; color:#2F3437; border:1px solid #DCDBD7; border-right:0; border-radius:6px 0 0 6px;
      font:500 12px/1 'SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif; padding:12px 7px; font-variant-numeric:tabular-nums; }
    .tab:hover { background:#F1F0ED; }
    @media (prefers-color-scheme: dark) {
      .panel { border-left-color:#2A2D34; }
      .tab { background:#15161A; color:#E6E4DF; border-color:#3A3E47; }
      .tab:hover { background:#23262C; } }
    :host(.closed) .panel { display:none; }
    :host(:not(.closed)) .tab { display:none; }`;
  const panel = document.createElement("div");
  panel.className = "panel";
  const tab = document.createElement("button");
  tab.className = "tab";
  tab.textContent = "Tasks";
  shadow.append(frame, panel, tab);

  const close = document.createElement("button");

  close.className = "ib";
  close.title = "Hide panel";
  close.textContent = "›";

  const setOpen = (open, save = true) => {
    host.classList.toggle("closed", !open);
    document.documentElement.classList.toggle("ctl-open", open);
    if (save) chrome.storage.local.set({ open });
  };
  tab.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));

  const getCsrf = async () => {
    const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  };

  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.open) setOpen(ch.open.newValue !== false, false); });

  chrome.storage.local.get(["open"], (d) => {
    setOpen(d.open !== false, false);
    document.body.append(host);
    chrome.storage.local.set({ origin: location.origin });
    window.Quickstudy.mount(panel, {
      base: location.origin,
      getCsrf,
      extraHeader: close,
      onCount: (n) => { tab.textContent = n ? `Tasks ${n}` : "Tasks"; },
    });
  });
})();
