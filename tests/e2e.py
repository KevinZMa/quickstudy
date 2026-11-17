"""End-to-end checks for Quickstudy against a mocked Canvas.

Loads the unpacked extension in headless Chrome, serves fake Canvas pages and API
responses, and checks the panel, reader, palette and popup flows.

    pip install playwright
    python tests/e2e.py            # set CHROME=/path/to/chrome if needed
"""
import datetime as dt, hashlib, json, os, random, re, shutil, sys, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

EXT = str((Path(__file__).resolve().parent.parent / "extension"))
HOST = "https://example.instructure.com"
CHROME = os.environ.get("CHROME")
random.seed(7)
now = dt.datetime.now(dt.timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")

# ---------- fake school ----------
COURSES = {101: "[2] AP Biology S1 - Smith", 102: "[3] World History S1 - Garcia", 103: "[5] Calculus BC - Chen",
           104: "[6] English Literature - Patel", 201: "Robotics Club", 202: "Chess Club"}
FAVORITES = {101, 102, 103, 104}
TOPICS = {101: ["Cell Membranes", "Enzyme Kinetics", "Photosynthesis", "Mitosis"], 102: ["Silk Road", "Industrial Revolution", "Cold War"],
          103: ["Limits", "Derivatives", "Integration by Parts", "Series"], 104: ["Close Reading", "Sonnets", "Argument Essay"]}
DATA = {}
for cid, name in COURSES.items():
    words = TOPICS.get(cid, ["Meeting", "Sign-up", "Agenda"])
    asg = []
    for i in range(60 if cid in FAVORITES else 8):
        kind = random.choice(["Problem Set", "Lab", "Reading", "Notes", "Quiz"])
        due = now + dt.timedelta(days=random.randint(-40, 20), hours=random.randint(0, 23))
        a = {"id": cid * 1000 + i, "name": f"{kind} {random.randint(1, 5)}.{random.randint(1, 5)}: {random.choice(words)}",
             "due_at": iso(due), "points_possible": 10, "updated_at": iso(now), "submission_types": ["online_upload"],
             "html_url": f"/courses/{cid}/assignments/{cid * 1000 + i}"}
        if kind == "Quiz": a["quiz_id"] = a["id"]
        asg.append(a)
    mods = [{"id": cid * 10 + m, "name": f"Unit {m + 1}: {random.choice(words)}", "position": m + 1,
             "items": [{"type": "File", "content_id": cid * 100 + m * 10 + j, "title": f"Unit {m + 1} Reading {j + 1}.pdf",
                        "html_url": f"/courses/{cid}/modules/items/{cid * 100 + m * 10 + j}"} for j in range(4)]} for m in range(3)]
    DATA[cid] = {"asg": asg, "mods": mods}

PLANNER = []
for cid in FAVORITES:
    for a in DATA[cid]["asg"]:
        days = (dt.datetime.fromisoformat(a["due_at"].replace("Z", "+00:00")) - now).days
        if -2 <= days <= 6 and not a.get("quiz_id"):
            PLANNER.append({"plannable_id": a["id"], "plannable_type": "assignment", "plannable_date": a["due_at"], "html_url": a["html_url"],
                            "context_name": COURSES[cid], "course_id": cid, "submissions": {"submitted": False, "missing": days < 0},
                            "planner_override": None, "plannable": {"title": a["name"], "points_possible": 10, "updated_at": iso(now)}})
PLANNER = PLANNER[:10]

DESCRIPTION = ("<p>Read the handout and answer the questions.</p><ul><li>Show your work</li></ul>"
               "<img src=x onerror=\"alert('xss')\"><script>alert('xss')</script><a href=\"javascript:alert('xss')\">bad link</a>")

def handle(route):
    p = route.request.url.split("instructure.com", 1)[1]
    if p.startswith("/robots.txt"): return route.fulfill(content_type="text/plain", body="User-agent: *\n")
    if p.startswith("/api/v1/planner/items"): return route.fulfill(json=PLANNER)
    if p.startswith("/api/v1/planner/overrides"): return route.fulfill(json={"id": 1, "marked_complete": True})
    if p.startswith("/api/v1/courses?"):
        return route.fulfill(json=[{"id": c, "name": n, "course_code": n, "is_favorite": c in FAVORITES} for c, n in COURSES.items()])
    if p.startswith("/api/v1/announcements"): return route.fulfill(json=[])
    if p.startswith("/api/v1/users/self/colors"): return route.fulfill(json={"custom_colors": {"course_101": "#ff8800", "user_1": "#000000"}})
    m = re.match(r"/api/v1/courses/(\d+)/(\w+)(?:/(\d+))?", p)
    if m:
        cid, what, one = int(m.group(1)), m.group(2), m.group(3)
        if what == "assignments" and one:
            a = next(x for x in DATA[cid]["asg"] if x["id"] == int(one))
            return route.fulfill(json={**a, "description": DESCRIPTION, "submission": {}})
        if what == "assignments": return route.fulfill(json=DATA[cid]["asg"])
        if what == "modules": return route.fulfill(json=DATA[cid]["mods"])
        if what in ("pages", "files"): return route.fulfill(status=403, json={})
        return route.fulfill(json=[])
    if route.request.resource_type != "document": return route.fulfill(status=404, body="")
    time.sleep(0.8)  # simulate full-page latency. The handler is serial, so only page loads wait.
    route.fulfill(content_type="text/html", body="<html><body><h1 id=real>Full Canvas page</h1></body></html>")

def ext_id(path):
    return "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(path.encode()).hexdigest()[:32])

VISIBLE = lambda host: f"(() => {{ const h = document.getElementById('{host}'); return !!h && h.checkVisibility() && h.shadowRoot.firstElementChild && [...h.shadowRoot.children].some(c => c.checkVisibility && c.checkVisibility()); }})()"
READER_OPEN = "(() => { const h = document.getElementById('quickstudy-reader'); return h && !h.hidden && !!h.shadowRoot.querySelector('h1'); })()"
PANEL = "document.getElementById('quickstudy-host').shadowRoot"
PAL = "document.getElementById('quickstudy-palette').shadowRoot"
results = []
def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))

profile = tempfile.mkdtemp(prefix="quickstudy-e2e-")
try:
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(profile, executable_path=CHROME, headless=True,
            args=["--headless=new", f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"], viewport={"width": 1200, "height": 760})
        ctx.route(f"{HOST}/**", handle)
        dialogs = []
        page = ctx.new_page()
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.goto(f"{HOST}/courses/101"); page.wait_for_timeout(2500)

        # Panel
        rows = page.evaluate(f"{PANEL}.querySelectorAll('.row').length")
        check("panel lists open tasks", rows > 0, f"{rows} rows")
        page.evaluate(f"{PANEL}.querySelector('.row .check').click()"); page.wait_for_timeout(300)
        check("checkbox does not open the reader", not page.evaluate(READER_OPEN))

        # Reader
        t0 = time.time()
        page.evaluate(f"{PANEL}.querySelectorAll('.row .title')[1].click()")
        page.wait_for_function(READER_OPEN)
        check("reader opens from the panel", True, f"{round((time.time() - t0) * 1000)} ms")
        check("reader keeps the real URL", "/assignments/" in page.url)
        page.wait_for_timeout(300)
        check("teacher HTML is sanitised", not dialogs and not page.evaluate(
            "[...document.getElementById('quickstudy-reader').shadowRoot.querySelectorAll('a')].some(a => a.href.startsWith('javascript'))"))
        page.keyboard.press("Escape"); page.wait_for_timeout(200)
        check("Esc closes the reader and restores the URL", page.url.endswith("/courses/101"))
        check("closed reader is actually off screen", not page.evaluate("document.getElementById('quickstudy-reader').checkVisibility()"))

        # Canvas course colours are used when set
        tint = page.evaluate(f"[...{PANEL}.querySelectorAll('.row')].map(r => r.style.getPropertyValue('--ti')).find(v => v.includes('#ff8800')) || ''")
        check("panel uses the course colour chosen in Canvas", "#ff8800" in tint, tint[:48])

        # Palette
        page.keyboard.press("Control+k")
        page.wait_for_function(f"/^\\d/.test({PAL}.querySelector('.st').textContent)", timeout=20000)
        n = page.evaluate(f"{PAL}.querySelector('.st').textContent")
        check("index builds", True, n)
        page.keyboard.type("*bio", delay=15); page.wait_for_timeout(100)
        top = page.evaluate(f"{PAL}.querySelector('li.r .t').textContent")
        check("course prefix finds the course", top == "Biology", top)
        page.keyboard.press("Tab"); page.keyboard.type("enzyme", delay=15); page.wait_for_timeout(100)
        titles = page.evaluate(f"[...{PAL}.querySelectorAll('li.r .t')].map(x => x.textContent)")
        check("Tab scopes the search to the course", titles and all("Enzyme" in t for t in titles[:3]), titles[:2])
        page.keyboard.press("Enter")
        page.wait_for_function(READER_OPEN)
        check("Enter opens the result in the reader", True)
        page.keyboard.press("Escape"); page.wait_for_timeout(200)

        # Esc in the palette: clear the text, leave the course, then close (and actually disappear)
        PAL_SHOWN = "(() => { const h = document.getElementById('quickstudy-palette'); return !!h && h.shadowRoot.querySelector('.pal').checkVisibility(); })()"
        page.keyboard.press("Control+k"); page.wait_for_timeout(150)
        page.keyboard.type("*bio", delay=15); page.keyboard.press("Tab"); page.keyboard.type("lab", delay=15); page.wait_for_timeout(100)
        page.keyboard.press("Escape"); page.wait_for_timeout(80)
        step1 = page.evaluate(f"{PAL}.querySelector('input').value") == "" and page.evaluate(PAL_SHOWN)
        page.keyboard.press("Escape"); page.wait_for_timeout(80)
        step2 = page.evaluate(f"{PAL}.querySelector('.scope').hidden") and page.evaluate(PAL_SHOWN)
        page.keyboard.press("Escape"); page.wait_for_timeout(80)
        step3 = not page.evaluate(PAL_SHOWN)
        check("Esc clears, then leaves the course, then closes", step1 and step2 and step3, f"{step1}/{step2}/{step3}")
        page.keyboard.press("Control+k"); page.wait_for_timeout(150)
        page.evaluate(f"{PAL}.querySelector('input').blur()")
        page.keyboard.press("Escape"); page.wait_for_timeout(80)
        check("Esc closes even when the box isn't focused", not page.evaluate(PAL_SHOWN))

        # Popup: from a non-Canvas tab, a task opens on Canvas through the fast shell
        popup = ctx.new_page(); popup.goto(f"chrome-extension://{ext_id(EXT)}/popup.html"); popup.wait_for_timeout(600)
        t0 = time.time()
        with ctx.expect_page() as newp:
            popup.locator(".row .title").first.click()
        tab = newp.value
        tab.wait_for_function(READER_OPEN, timeout=8000)
        check("popup opens the task on Canvas", tab.url.startswith(HOST + "/courses/"), f"{round((time.time() - t0) * 1000)} ms")
        tab.reload(); tab.wait_for_load_state()
        check("reloading gives the full Canvas page", tab.evaluate("!!document.getElementById('real')"))
        ctx.close()
finally:
    shutil.rmtree(profile, ignore_errors=True)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
