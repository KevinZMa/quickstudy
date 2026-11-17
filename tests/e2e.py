"""End-to-end checks for Quickstudy against a mocked Canvas.

Loads the unpacked extension in headless Chrome, serves fake Canvas pages and API
responses, and checks the panel, reader, palette and popup flows.

    pip install playwright && playwright install chromium
    python tests/e2e.py   # CHROME=/path/to/chromium to use another Chromium build
"""
import datetime as dt, hashlib, json, os, random, re, shutil, sys, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright

EXT = str((Path(__file__).resolve().parent.parent / "extension"))
HOST = "https://example.instructure.com"
CHROME = os.environ.get("CHROME")
SHOTS = os.environ.get("SHOTS")  # optional screenshot directory
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
    if cid == 101:  # a module page in a course whose Pages tab is hidden (pages API answers 403)
        mods[0]["items"].append({"type": "Page", "page_url": "lab-safety", "title": "Lab Safety Rules", "html_url": "/courses/101/modules/items/9001"})
    DATA[cid] = {"asg": asg, "mods": mods}

# ---------- planner fixtures (local time) ----------
day0 = dt.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
at = lambda d, h, m: (day0 + dt.timedelta(days=d, hours=h, minutes=m)).astimezone()
rel = lambda **kw: (dt.datetime.now() + dt.timedelta(**kw)).astimezone()
T, F = True, False
FIX = [  # title, course, due, planner submissions, override, submission types
    ("Fixture A: Missing lab", 101, rel(hours=-49), {"submitted": F, "missing": T}, None, None),
    ("Fixture B: Reading notes", 101, rel(hours=-26), False, None, None),
    ("Fixture C: Problem set", 101, rel(hours=2, minutes=5), {"submitted": F}, None, None),
    ("Fixture M: Early lab", 101, at(2, 0, 30), {"submitted": F}, None, None),
    ("Fixture D: Morning quiz prep", 101, at(3, 8, 0), {"submitted": F}, None, None),
    ("Fixture E: Essay outline", 101, at(3, 23, 59), {"submitted": F}, None, None),
    ("Fixture F: Paper worksheet", 101, at(4, 23, 59), {"submitted": F}, None, ["on_paper"]),
    ("Fixture N: History reading", 102, at(5, 23, 59), {"submitted": F}, None, None),
    ("Fixture H: Unit test", 101, at(10, 23, 59), {"submitted": F}, None, None),
    ("Fixture G: Graded on paper", 101, rel(days=-3), {"submitted": F, "graded": T, "with_feedback": T}, None, None),
    ("Fixture I: Late upload", 101, rel(days=-2), {"submitted": T, "late": T}, None, None),
    ("Fixture J: On-time upload", 101, rel(days=-1), {"submitted": T}, None, None),
    ("Fixture K: Dismissed reading", 101, rel(days=-1), {"submitted": F}, {"id": 5, "marked_complete": T}, None),
    ("Fixture P: Done elsewhere", 102, rel(days=-2), {"submitted": T, "late": T}, None, None),
]
PLANNER, BY_TITLE = [], {}
for n, (title, cid, due, sub, override, types) in enumerate(FIX):
    aid = cid * 1000 + 900 + n
    url = f"/courses/{cid}/assignments/{aid}"
    if sub is not False:
        DATA[cid]["asg"].append({"id": aid, "name": title, "due_at": iso(due.astimezone(dt.timezone.utc)), "points_possible": 10,
                                 "updated_at": iso(now), "submission_types": types or ["online_upload"], "html_url": url})
    BY_TITLE[title] = (aid, due)
    PLANNER.append({"plannable_id": aid, "plannable_type": "assignment" if sub is not False else "planner_note", "plannable_date": due.isoformat(),
                    "html_url": url if sub is not False else f"/planner_notes/{aid}", "context_name": COURSES[cid], "course_id": cid,
                    "submissions": sub, "planner_override": override, "plannable": {"title": title, "points_possible": 10}})
SUBS = {101: [  # what /students/submissions returns for course 101; course 102 fails (500)
    {"assignment_id": BY_TITLE["Fixture I: Late upload"][0], "submitted_at": iso((BY_TITLE["Fixture I: Late upload"][1] + dt.timedelta(hours=3)).astimezone(dt.timezone.utc)),
     "late": T, "seconds_late": 10800, "workflow_state": "submitted", "score": None},
    {"assignment_id": BY_TITLE["Fixture J: On-time upload"][0], "submitted_at": iso((BY_TITLE["Fixture J: On-time upload"][1] - dt.timedelta(days=1)).astimezone(dt.timezone.utc)),
     "late": F, "seconds_late": 0, "workflow_state": "submitted", "score": None},
    {"assignment_id": BY_TITLE["Fixture G: Graded on paper"][0], "submitted_at": None, "late": F, "workflow_state": "graded", "score": 8},
]}
HIDDEN = {"id": 101999, "name": "Archived Worksheet: Quasar", "due_at": None, "points_possible": 5, "updated_at": iso(now),
          "submission_types": ["online_upload"], "html_url": "/courses/101/assignments/101999"}
LIVE = []  # every request with search_term

# ---------- files ----------
import io, zipfile
PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj "
       b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF")
def docx(text):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                   f'<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>')
    return b.getvalue()
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FILES = {10100: ("Lab handout.pdf", "application/pdf", PDF), 10101: ("Notes.docx", DOCX_TYPE, docx("Hello from Word"))}
file_of = lambda fid: FILES.get(fid, (f"File {fid}.pdf", "application/pdf", PDF))
FS = "https://inst-fs-iad-prod.inscloudgate.net"
def handle_fs(route):
    name, ctype, body = file_of(int(re.search(r"/files/(\d+)", route.request.url).group(1)))
    route.fulfill(status=200, content_type=ctype, body=body)
def handle_google(route):
    route.fulfill(status=200, content_type="application/pdf", body=PDF)

D_ID = BY_TITLE["Fixture D: Morning quiz prep"][0]
DESCRIPTION = ("<p>Read the <a href=\"/courses/101/files/10100\">handout</a>, then the <a href=\"/courses/101/assignments/%d\">next task</a>"
               " and the <a href=\"https://docs.google.com/document/d/abc123/edit\">shared doc</a>.</p>" % D_ID +
               "<p>Read the handout and answer the questions.</p><ul><li>Show your work</li></ul>"
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
    f = re.match(r"/api/v1/files/(\d+)", p)
    if f:
        name, ctype, body = file_of(int(f.group(1)))
        return route.fulfill(json={"id": int(f.group(1)), "display_name": name, "content-type": ctype, "size": len(body),
                                   "url": f"{FS}/files/{f.group(1)}?token=t"})  # real Canvas: a download link that redirects here
    f = re.match(r"(?:/courses/\d+)?/files/(\d+)/download", p)
    if f:
        name, ctype, body = file_of(int(f.group(1)))
        return route.fulfill(status=200, content_type=ctype, body=body)
    if "search_term=" in p:
        LIVE.append(p)
        term = re.search(r"search_term=([^&]+)", p).group(1).lower()
        hit = p.startswith("/api/v1/courses/101/assignments") and term in HIDDEN["name"].lower()
        return route.fulfill(json=[HIDDEN] if hit else [])
    m = re.match(r"/api/v1/courses/(\d+)/(\w+)(?:/(\d+))?", p)
    if m:
        cid, what, one = int(m.group(1)), m.group(2), m.group(3)
        if what == "students": return route.fulfill(json=SUBS[cid]) if cid in SUBS else route.fulfill(status=500, json={})
        if what == "assignments" and one:
            a = next(x for x in DATA[cid]["asg"] if x["id"] == int(one))
            return route.fulfill(json={**a, "description": DESCRIPTION, "submission": {}})
        if what == "assignments": return route.fulfill(json=DATA[cid]["asg"])
        if what == "modules": return route.fulfill(json=DATA[cid]["mods"])
        if what in ("pages", "files"): return route.fulfill(status=403, json={})
        return route.fulfill(json=[])
    if route.request.resource_type != "document": return route.fulfill(status=404, body="")
    time.sleep(0.8)  # full-page latency
    route.fulfill(content_type="text/html", body="<html><body><h1 id=real>Full Canvas page</h1></body></html>")

def ext_id(path):
    return "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(path.encode()).hexdigest()[:32])

VISIBLE = lambda host: f"(() => {{ const h = document.getElementById('{host}'); return !!h && h.checkVisibility() && h.shadowRoot.firstElementChild && [...h.shadowRoot.children].some(c => c.checkVisibility && c.checkVisibility()); }})()"
READER_OPEN = "(() => { const h = document.getElementById('quickstudy-reader'); return h && !h.hidden && !!h.shadowRoot.querySelector('h1'); })()"
PANEL = "document.getElementById('quickstudy-host').shadowRoot"
PAL = "document.getElementById('quickstudy-palette').shadowRoot"
ROW = lambda root, title: f"[...{root}.querySelectorAll('.row')].find(r => r.querySelector('.title').textContent === {json.dumps(title)})"
results = []
def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))

profile = tempfile.mkdtemp(prefix="quickstudy-e2e-")
try:
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(profile, executable_path=CHROME, headless=True, channel=None if CHROME else "chromium",
            args=["--headless=new", f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"], viewport={"width": 1200, "height": 760})
        ctx.route(f"{HOST}/**", handle)
        ctx.route(f"{FS}/**", handle_fs)
        ctx.route("https://docs.google.com/**", handle_google)
        dialogs = []
        page = ctx.new_page()
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.goto(f"{HOST}/courses/101"); page.wait_for_timeout(2500)

        # Panel
        rows = page.evaluate(f"{PANEL}.querySelectorAll('.row').length")
        check("panel lists open tasks", rows > 0, f"{rows} rows")

        # Timeline
        when = lambda t: page.evaluate(f"{ROW(PANEL, t)}?.querySelector('.when')?.textContent ?? ''")
        has = lambda t, sel: page.evaluate(f"!!{ROW(PANEL, t)}?.querySelector('{sel}')")
        cls = lambda t, c: page.evaluate(f"!!{ROW(PANEL, t)}?.classList.contains('{c}')")
        lbl = lambda t: page.evaluate(f"{ROW(PANEL, t)}?.querySelector('.lbl')?.textContent ?? ''")
        wd = lambda d: (day0 + dt.timedelta(days=d)).strftime("%a")
        check("graded work with no submission counts as done", page.evaluate(f"!{ROW(PANEL, 'Fixture G: Graded on paper')}"))
        check("missing work shows days late and a flag", when("Fixture A: Missing lab") == "2d late" and has("Fixture A: Missing lab", ".flag"), when("Fixture A: Missing lab"))
        check("past work with nothing to upload says ago, dashed", when("Fixture B: Reading notes") == "1d ago" and cls("Fixture B: Reading notes", "noup"), when("Fixture B: Reading notes"))
        check("near deadlines count down", when("Fixture C: Problem set") == "in 2h", when("Fixture C: Problem set"))
        check("an unusual time shows", when("Fixture D: Morning quiz prep") == "8:00a", when("Fixture D: Morning quiz prep"))
        check("11:59p shows nothing", when("Fixture E: Essay outline") == "")
        check("day label on the first row of a day only", lbl("Fixture D: Morning quiz prep") == wd(3) and lbl("Fixture E: Essay outline") == "", lbl("Fixture D: Morning quiz prep"))
        check("00:30 sits on its own day", lbl("Fixture M: Early lab") == wd(2) and when("Fixture M: Early lab") == "12:30a", (lbl("Fixture M: Early lab"), when("Fixture M: Early lab")))
        d10 = day0 + dt.timedelta(days=10)
        check("after a week the label is a date", lbl("Fixture H: Unit test") == f"{d10.strftime('%b')} {d10.day}", lbl("Fixture H: Unit test"))
        check("now line under late work", page.evaluate(f"!!{PANEL}.querySelector('.now')"))
        check("empty days show a dot", page.evaluate(f"{PANEL}.querySelectorAll('.gap').length") >= 2)
        check("late text is not red", page.evaluate(f"getComputedStyle({ROW(PANEL, 'Fixture A: Missing lab')}.querySelector('.when')).color") != "rgb(159, 47, 45)")
        page.wait_for_function(f"{ROW(PANEL, 'Fixture F: Paper worksheet')}?.classList.contains('noup')", timeout=20000)
        check("paper hand-ins get a dashed ring once the index is ready", True)
        page.evaluate(f"[...{PANEL}.querySelectorAll('.f')].find(b => b.title.includes('World History')).click()"); page.wait_for_timeout(100)
        check("filtered course with no late work has no now line", page.evaluate(f"!{PANEL}.querySelector('.now')"))
        page.evaluate(f"{PANEL}.querySelector('.f.on').click()"); page.wait_for_timeout(100)
        if SHOTS:
            for scheme in ("light", "dark"):
                page.emulate_media(color_scheme=scheme); page.wait_for_timeout(150)
                page.locator("#quickstudy-host").screenshot(path=f"{SHOTS}/panel-{scheme}.png")
            page.emulate_media(color_scheme="light")

        page.evaluate(f"{ROW(PANEL, 'Fixture E: Essay outline')}.querySelector('.check').click()"); page.wait_for_timeout(300)
        check("checkbox does not open the reader", not page.evaluate(READER_OPEN))

        # Done section
        page.evaluate(f"{PANEL}.querySelector('.ib[title=\"Show completed\"]').click()")
        page.wait_for_function(f"{ROW(PANEL, 'Fixture I: Late upload')}?.querySelector('.when')?.textContent === 'submitted 3h late'", timeout=5000)
        check("late submission shows how late", True)
        j = when("Fixture J: On-time upload")
        check("on-time submission shows when", j.startswith("submitted ") and not j.endswith("late") and j != "submitted", j)
        check("dismissed task says dismissed", when("Fixture K: Dismissed reading") == "dismissed")
        check("graded task shows the score and feedback", when("Fixture G: Graded on paper") == "8/10" and has("Fixture G: Graded on paper", ".fb"), when("Fixture G: Graded on paper"))
        check("planner data alone still labels the row", when("Fixture P: Done elsewhere") == "submitted late", when("Fixture P: Done elsewhere"))
        if SHOTS:
            for scheme in ("light", "dark"):
                page.emulate_media(color_scheme=scheme); page.wait_for_timeout(150)
                page.locator("#quickstudy-host").screenshot(path=f"{SHOTS}/done-{scheme}.png")
            page.emulate_media(color_scheme="light")
        page.evaluate(f"{PANEL}.querySelector('.ib[title=\"Hide completed\"]').click()")

        # Reader
        t0 = time.time()
        page.evaluate(f"{ROW(PANEL, 'Fixture C: Problem set')}.querySelector('.title').click()")
        page.wait_for_function(READER_OPEN)
        check("reader opens from the panel", True, f"{round((time.time() - t0) * 1000)} ms")
        check("reader keeps the real URL", "/assignments/" in page.url)
        page.wait_for_timeout(300)
        check("teacher HTML is sanitised", not dialogs and not page.evaluate(
            "[...document.getElementById('quickstudy-reader').shadowRoot.querySelectorAll('a')].some(a => a.href.startsWith('javascript'))"))
        page.keyboard.press("Escape"); page.wait_for_timeout(200)
        check("Esc closes the reader and restores the URL", page.url.endswith("/courses/101"))
        check("closed reader is actually off screen", not page.evaluate("document.getElementById('quickstudy-reader').checkVisibility()"))

        # Workspace
        R = "document.getElementById('quickstudy-reader').shadowRoot"
        panes = lambda: page.evaluate(f"{R}.querySelectorAll('.pane').length")
        def viewer(fid_or_key, js="document.getElementById('v').dataset.state"):
            for _ in range(80):
                fr = [f for f in page.frames if "viewer.html" in f.url and str(fid_or_key) in f.url]
                if fr:
                    try:
                        v = fr[-1].evaluate(js)
                        if v and v != "loading": return v
                    except Exception: pass
                page.wait_for_timeout(100)
            return None
        click_in = lambda i, text: page.evaluate(f"[...{R}.querySelectorAll('.pane')[{i}].querySelectorAll('a')].find(a => a.textContent === {json.dumps(text)}).click()")
        page.evaluate(f"{ROW(PANEL, 'Fixture C: Problem set')}.querySelector('.title').click()")
        page.wait_for_function(f"{R}.querySelector('.tl .due')", timeout=5000)
        due = page.evaluate(f"{R}.querySelector('.tl .due .x').textContent")
        check("workspace shows the due date on a timeline", due.startswith("in 2h"), due)
        page.wait_for_function(f"{R}.querySelector('.files')", timeout=10000)
        heads = page.evaluate(f"[...{R}.querySelectorAll('.files h3, .files summary')].map(x => x.textContent)")
        check("Files lists linked files and module files", "In the text" in heads and any(h.startswith("Unit") for h in heads), heads)
        click_in(0, "Unit 1 Reading 1.pdf")
        page.wait_for_function(f"{R}.querySelectorAll('.pane').length === 2")
        check("a PDF opens in a pane next to the assignment", viewer("10100") == "pdf", viewer("10100"))
        page.wait_for_function(f"{R}.querySelectorAll('.pane')[1].querySelector('.name').textContent === 'Lab handout.pdf'", timeout=3000)
        check("the file pane shows the file's name", True)
        click_in(0, "Unit 1 Reading 2.pdf")
        page.wait_for_timeout(200)
        check("a link in pane 1 replaces the panes to its right", panes() == 2)
        txt = viewer("10101", "document.querySelector('article')?.textContent")
        check("a Word file opens as text", txt == "Hello from Word", txt)
        click_in(0, "shared doc")
        check("a Google Doc opens as a PDF pane", viewer("abc123") == "pdf")
        click_in(0, "next task")
        page.wait_for_function(f"{R}.querySelectorAll('.pane')[1]?.querySelector('h1')?.textContent === 'Fixture D: Morning quiz prep'", timeout=5000)
        click_in(1, "handout")
        page.wait_for_function(f"{R}.querySelectorAll('.pane').length === 3"); page.wait_for_timeout(800)
        check("three panes: the first folds into a title strip", page.evaluate(f"{R}.querySelectorAll('.pane')[0].classList.contains('folded')"))
        check("the link that opened the next pane is marked", page.evaluate(f"{R}.querySelectorAll('.pane')[1].querySelector('a.active')?.textContent") == "handout")
        check("swipes do not trigger back/forward while panes are open", page.evaluate("document.documentElement.style.overscrollBehaviorX") == "none")
        x0 = page.evaluate(f"{R}.querySelector('.strip').scrollLeft")
        page.mouse.move(60, 300); page.mouse.wheel(0, -400); page.wait_for_timeout(300)
        check("the mouse wheel over a title strip scrolls sideways", page.evaluate(f"{R}.querySelector('.strip').scrollLeft") < x0)
        page.evaluate(f"{R}.querySelector('.strip').scrollLeft = 1e6"); page.wait_for_timeout(200)
        if SHOTS: page.screenshot(path=f"{SHOTS}/workspace.png")
        page.keyboard.press("Escape"); page.wait_for_timeout(150)
        check("Esc closes the last pane", panes() == 2)
        page.evaluate(f"[...{R}.querySelectorAll('.pane')[0].querySelectorAll('.fi')].find(li => li.textContent.includes('Unit 1 Reading 3.pdf')).querySelector('button').click()")
        page.wait_for_timeout(150)
        pinned = page.evaluate(f"(() => {{ const h = [...{R}.querySelectorAll('.pane')[0].querySelectorAll('.files h3')].find(x => x.textContent === 'Pinned'); return h ? h.nextElementSibling.textContent : ''; }})()")
        check("a file can be pinned to the assignment", "Unit 1 Reading 3.pdf" in pinned, pinned)
        page.keyboard.press("Control+k"); page.keyboard.type(".reading 4", delay=15); page.wait_for_timeout(200)
        page.keyboard.press("Shift+Enter"); page.wait_for_timeout(150)
        check("Shift+Enter in search pins a file", page.evaluate(f"{PAL}.querySelector('.st').textContent").startswith("pinned to"))
        page.keyboard.press("Enter"); page.wait_for_timeout(300)
        check("a file from search opens beside", panes() == 3)
        page.evaluate(f"{ROW(PANEL, 'Fixture D: Morning quiz prep')}.querySelector('.title').click()"); page.wait_for_timeout(300)
        check("a task list click switches the workspace", panes() == 1 and page.evaluate(f"{R}.querySelector('h1')?.textContent") == "Fixture D: Morning quiz prep")
        page.locator("#quickstudy-host .row .title", has_text="Fixture M: Early lab").click(modifiers=["Alt"]); page.wait_for_timeout(300)
        check("⌥-click in the task list opens beside", panes() == 2)
        page.evaluate(f"{R}.querySelector('.pane .close').click()"); page.wait_for_timeout(300)
        check("closing the first pane lets the next one fill", panes() == 1 and page.evaluate(f"{R}.querySelector('h1')?.textContent") == "Fixture M: Early lab")
        page.evaluate(f"{R}.querySelector('.pane .close').click()"); page.wait_for_timeout(300)
        check("closing the last pane closes the workspace", not page.evaluate(READER_OPEN) and page.url.endswith("/courses/101"), page.url)
        page.evaluate(f"{ROW(PANEL, 'Fixture C: Problem set')}.querySelector('.title').click()"); page.wait_for_timeout(300)
        check("reopening an assignment restores its panes", panes() == 3, panes())
        for _ in range(3): page.keyboard.press("Escape"); page.wait_for_timeout(150)
        check("Esc on the last pane closes the workspace", not page.evaluate(READER_OPEN) and page.url.endswith("/courses/101"), page.url)

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

        # Esc in the palette
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

        # Search: module pages in a course with a hidden Pages tab
        page.keyboard.press("Control+k"); page.keyboard.type("/lab safety", delay=15); page.wait_for_timeout(150)
        top = page.evaluate(f"{PAL}.querySelector('li.r .t')?.textContent")
        check("module pages are indexed when the Pages tab is hidden", top == "Lab Safety Rules", top)
        page.keyboard.press("Escape"); page.keyboard.press("Escape")

        # Search: live Canvas fallback
        q_hits = lambda: [h for h in LIVE if re.search(r"search_term=quasar(&|$)", h)]
        page.keyboard.press("Control+k"); page.keyboard.type("#quasar", delay=15)
        page.wait_for_function(f"[...{PAL}.querySelectorAll('li.r .t')].some(t => t.textContent === 'Archived Worksheet: Quasar')", timeout=5000)
        heads = page.evaluate(f"[...{PAL}.querySelectorAll('li.h')].map(h => h.textContent)")
        check("live search finds items outside the index", "From Canvas" in heads, heads)
        check("live search sends the query without the prefix", bool(q_hits()) and not any("%23" in h for h in LIVE))
        n = len(q_hits()); page.keyboard.press("Backspace"); page.keyboard.type("r", delay=15); page.wait_for_timeout(600)
        check("the same query is not sent twice", len(q_hits()) == n, f"{n} -> {len(q_hits())}")
        page.keyboard.press("Escape"); page.keyboard.press("Escape")
        page.keyboard.press("Control+k"); page.keyboard.type(">refresh", delay=15); page.keyboard.press("Enter")
        page.keyboard.press("Control+k")  # reopen, so .st shows the live build state
        page.wait_for_function(f"/^\\d/.test({PAL}.querySelector('.st').textContent)", timeout=20000)
        page.keyboard.type("quasar", delay=15); page.wait_for_timeout(400)
        titles = page.evaluate(f"[...{PAL}.querySelectorAll('li.r .t')].map(t => t.textContent)")
        check("live results survive an index rebuild", "Archived Worksheet: Quasar" in titles, titles[:3])
        page.keyboard.press("Escape"); page.keyboard.press("Escape")

        # Popup
        popup = ctx.new_page(); popup.on("pageerror", lambda e: print("popup error:", e)); popup.on("console", lambda m: print("popup console:", m.text) if m.type == "error" else None); popup.goto(f"chrome-extension://{ext_id(EXT)}/popup.html"); popup.bring_to_front(); popup.wait_for_timeout(600)
        t0 = time.time()
        with ctx.expect_page() as newp:
            popup.locator(".row .title", has_text="Fixture C: Problem set").first.click()
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
