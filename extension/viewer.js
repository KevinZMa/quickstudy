// File viewer for workspace panes: PDFs (including Google exports) in Chrome's PDF viewer,
// .docx via mammoth.js, images and text inline, other types as a download link.
const params = new URLSearchParams(location.search);
const src = params.get("src"), parentOrigin = params.get("origin");
const v = document.getElementById("v");

const show = (state, ...nodes) => { v.dataset.state = state; v.replaceChildren(...nodes); };
const link = (text, href, extra = {}) => Object.assign(document.createElement("a"), { textContent: text, href, target: "_blank", rel: "noopener", ...extra });

function kindOf({ type = "", name = "" }) {
  const ext = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || "";
  if (type.includes("pdf") || ext === "pdf") return "pdf";
  if (type.startsWith("image/") || /^(png|jpe?g|gif|webp|svg)$/.test(ext)) return "image";
  if (type.includes("wordprocessingml") || ext === "docx") return "docx";
  if (type.startsWith("text/") || /^(txt|csv|md|py|js|java|c|cpp|html|css|json)$/.test(ext)) return "text";
  return "other";
}

function fallback(meta, blob, why) {
  const p = document.createElement("p");
  p.className = "msg";
  p.append(why, document.createElement("br"));
  if (meta && meta.open) p.append(link(meta.google ? "Open in Google" : "Open in Canvas", meta.open));
  if (blob) p.append(link("Download", URL.createObjectURL(blob), { download: (meta && meta.name) || "file" }));
  return p;
}

const loadScript = (s) => new Promise((ok, no) => document.head.append(Object.assign(document.createElement("script"), { src: s, onload: ok, onerror: no })));

self.QSFiles.load(src).then(async ({ blob, meta }) => {
  if (parentOrigin) parent.postMessage({ qsViewer: true, src, name: meta.name }, parentOrigin);
  document.title = meta.name || "File";
  const kind = kindOf(meta);
  if (kind === "pdf") {
    const f = document.createElement("iframe");
    f.src = URL.createObjectURL(new Blob([blob], { type: "application/pdf" })) + "#navpanes=0&view=FitH";
    return show("pdf", f);
  }
  if (kind === "image") return show("image", Object.assign(document.createElement("img"), { src: URL.createObjectURL(blob), alt: meta.name || "" }));
  if (kind === "text") return show("text", Object.assign(document.createElement("pre"), { textContent: (await blob.text()).slice(0, 2e6) }));
  if (kind === "docx") {
    await loadScript("vendor/mammoth.browser.min.js");
    const { value } = await self.mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
    const art = document.createElement("article");
    art.innerHTML = value;
    for (const a of art.querySelectorAll("a[href]")) {
      if (!/^https?:/i.test(a.getAttribute("href"))) a.removeAttribute("href");
      else { a.target = "_blank"; a.rel = "noopener"; }
    }
    return show("docx", art);
  }
  show("other", fallback(meta, blob, "No quick preview for this file type."));
}).catch((e) => show("error", fallback(e.meta || { open: src }, null,
  e.message === "google" ? "Google did not send this file. Sign in to Google in this browser, or check that you have access."
    : e.message === "too big" ? "This file is too large for a quick preview." : "Couldn't load this file.")));
