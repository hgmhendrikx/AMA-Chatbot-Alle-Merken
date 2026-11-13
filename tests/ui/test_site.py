"""Browsertest van de frontend, zonder echte API's of sleutels.

Test twee varianten van dezelfde frontend:
  1. Pages-build (scripts/build_pages.py) onder het subpad /AMA-Chatbot-Alle-Merken/,
     met een nagebootste Supabase-functie 'ask'.
  2. De Flask-template (zoals op Render), met nagebootste /ask en een nagebootste
     ElevenLabs-sessie voor de spraakmodus (client-tools, PDF-markering).

Draaien:
  pip install playwright jinja2 && python -m playwright install chromium
  python tests/ui/test_site.py
  (CHROME_PATH=/usr/bin/google-chrome gebruikt een bestaande Chrome)
"""
import functools
import http.server
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from brands import BRANDS  # noqa: E402

failures = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


def serve(directory, port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def common_routes(page):
    page.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(status=200, body=""))


# Nagebootste @elevenlabs/client: legt de opties vast zodat de test client-tools kan aanroepen
ELEVENLABS_STUB = """export const Conversation={startSession:async(opts)=>{window.__opts=opts;
const c={updates:[],sendContextualUpdate(t){this.updates.push(t)},
endSession:async()=>{window.__ended=true;opts.onDisconnect&&opts.onDisconnect({})}};
window.__conv=c;setTimeout(()=>opts.onConnect&&opts.onConnect({conversationId:'x'}),10);return c;}};"""


def test_pages(browser, tmp):
    cfg = Path(tmp) / "pages.config.json"
    cfg.write_text(json.dumps({"apiUrl": "https://fake.supabase.co/functions/v1/ask", "voiceTokenUrl": ""}))
    site_root = Path(tmp) / "pagesroot"
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/build_pages.py"), str(site_root / "AMA-Chatbot-Alle-Merken")],
        check=True, env={**os.environ, "PAGES_CONFIG": str(cfg)}, stdout=subprocess.DEVNULL,
    )
    srv = serve(site_root, 8766)
    reqs = []

    def api(route):
        req = route.request
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers={"access-control-allow-origin": "*",
                                                      "access-control-allow-headers": "content-type, x-access-code"})
        body = json.loads(req.post_data)
        reqs.append((body, req.headers.get("x-access-code")))
        if not req.headers.get("x-access-code"):
            return route.fulfill(status=401, headers={"access-control-allow-origin": "*"},
                                 content_type="application/json", body='{"answer":"Ongeldige toegangscode"}')
        if body["brand"] == "__all__":
            out = {"synthesis": "| Merk | LTV |\n|---|---|\n| Attens | 100% |\n\nConclusie.",
                   "brands": {k: {"answer": f"{k}: 100% (pagina 3)", "pages": [3]} for k in BRANDS}}
        else:
            out = {"answer": "De maximale LTV is **100%** (pagina 10).", "pages": [10]}
        route.fulfill(status=200, headers={"access-control-allow-origin": "*"},
                      content_type="application/json", body=json.dumps(out))

    print("\n— Pages-build —")
    pg = browser.new_page(viewport={"width": 1400, "height": 900})
    errs, bad = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 and "127.0.0.1" in r.url else None)
    pg.on("dialog", lambda d: d.accept("geheim"))
    common_routes(pg)
    pg.route("https://cdn.jsdelivr.net/**", lambda r: r.fulfill(status=200, content_type="application/javascript",
                                                                  body="export const Conversation={};"))
    pg.route("https://fake.supabase.co/**", api)

    pg.goto("http://127.0.0.1:8766/AMA-Chatbot-Alle-Merken/")
    pg.wait_for_timeout(500)
    check(pg.locator(".brand-item").count() == len(BRANDS) + 1, "zijbalk met alle merken + 'Alle merken'")
    check(not pg.is_visible("#voice-btn"), "microfoon verborgen zonder voiceTokenUrl")
    check(pg.is_visible(".welcome-bot") and "Hypo" in pg.inner_text("#welcome h2"), "welkomstscherm met Hypo")
    check(not pg.is_visible("#welcome-talk"), "praatknop verborgen zonder voiceTokenUrl")
    check(pg.locator(".welcome-chip").count() == len(BRANDS) + 1, "snelkeuze: alle merken + vergelijken")
    pg.click('.welcome-chip[data-key="cbleef"]')
    check(pg.inner_text("#header-title") == BRANDS["cbleef"]["name"]
          and "active" in pg.get_attribute('.welcome-chip[data-key="cbleef"]', "class")
          and pg.is_enabled("#query"), "snelkeuze selecteert merk en opent invoer")

    pg.click('.brand-item[data-key="attens"]')
    pg.fill("#query", "Wat is de max LTV?")
    pg.click("#send-btn")
    pg.wait_for_selector(".message.ai .bubble >> text=100%")
    check(reqs[-1] == ({"query": "Wat is de max LTV?", "brand": "attens"}, "geheim"),
          "vraag naar Supabase, toegangscode na 401 gevraagd en meegestuurd")
    pg.click(".message.ai .page-jump-btn")
    pg.wait_for_timeout(3000)
    src = pg.get_attribute("#pdf-frame-wrap iframe", "src")
    check(src.startswith("static/pdfjs/web/viewer.html?file=http%3A%2F%2F127.0.0.1%3A8766%2FAMA-Chatbot-Alle-Merken%2Fstatic%2Fpdfs%2F")
          and src.endswith("#page=10"), "PDF-pad klopt onder het Pages-subpad")
    n = pg.evaluate("document.querySelector('#pdf-frame-wrap iframe').contentWindow.PDFViewerApplication.pagesCount")
    check(bool(n), f"PDF geladen in de viewer ({n} pagina's)")

    pg.click('.brand-item[data-key="__all__"]')
    pg.fill("#query", "Vergelijk LTV")
    pg.click("#send-btn")
    pg.wait_for_selector(".all-brands-message")
    check(reqs[-1][0] == {"query": "Vergelijk LTV", "brand": "__all__"}, "alle merken → brand '__all__'")
    check(pg.locator(".all-brands-message table").count() == 1
          and pg.locator(".brand-detail-item").count() == len(BRANDS), "vergelijking met tabel en per-merk-details")
    check(not bad, f"geen 404's {bad}")
    check(not errs, f"geen JS-fouten {errs}")
    pg.close()
    srv.shutdown()


def test_flask_and_voice(browser):
    from jinja2 import Template

    html = (ROOT / "templates/index.html").read_text(encoding="utf-8")
    html = re.sub(r"\{\{ url_for\('static', filename='([^']+)'\) \}\}", r"/static/\1", html)
    html = Template(html).render(
        brands_json=json.dumps(BRANDS),
        app_config=json.dumps({"apiUrl": None,
                               "voiceTokenUrl": "https://fake.supabase.co/functions/v1/elevenlabs-token"}),
    )
    page_file = ROOT / "_test_index.html"
    page_file.write_text(html, encoding="utf-8")
    srv = serve(ROOT, 8765)
    try:
        print("\n— Flask-template + spraakmodus —")
        ctx = browser.new_context(permissions=["microphone"], viewport={"width": 1400, "height": 900})
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        common_routes(pg)
        pg.route("https://cdn.jsdelivr.net/**", lambda r: r.fulfill(
            status=200, content_type="application/javascript", body=ELEVENLABS_STUB))
        pg.route("https://fake.supabase.co/**", lambda r: r.fulfill(
            status=200, content_type="application/json",
            headers={"access-control-allow-origin": "*"}, body='{"token":"tok"}'))
        flask_calls = []

        def flask_ask(route):
            flask_calls.append((route.request.url, json.loads(route.request.post_data)))
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"answer": "Flask-antwoord (pagina 4)", "pages": [4]}))
        pg.route("**/ask", flask_ask)

        pg.goto("http://127.0.0.1:8765/_test_index.html")
        pg.wait_for_timeout(500)
        check(pg.is_visible("#welcome-talk"), "praatknop op welkomstscherm zichtbaar met voiceTokenUrl")

        # Praatknop op het welkomstscherm start direct een gesprek, ook zonder gekozen merk
        pg.click("#welcome-talk")
        pg.wait_for_function("window.__opts")
        pg.wait_for_timeout(100)
        check(pg.evaluate("__opts.dynamicVariables.actief_merk") == "geen"
              and pg.evaluate("document.body.dataset.voice") == "listening"
              and "luister" in pg.inner_text("#welcome-talk-label"), "praatknop: gesprek zonder merk, Hypo luistert")
        pg.click("#welcome-talk")
        pg.wait_for_timeout(100)
        check(pg.evaluate("document.body.dataset.voice") == "idle", "praatknop stopt het gesprek weer")
        pg.evaluate("delete window.__opts; delete window.__ended")

        # Flask-modus: zonder apiUrl gaat de chat naar /ask
        pg.click('.brand-item[data-key="cbleef"]')
        pg.fill("#query", "test")
        pg.click("#send-btn")
        pg.wait_for_selector("text=Flask-antwoord")
        check(flask_calls and flask_calls[0][0].endswith("/ask")
              and flask_calls[0][1] == {"query": "test", "brand": "cbleef"}, "Flask-modus: POST /ask")

        # Spraak starten
        check(pg.is_visible("#voice-btn"), "microfoonknop zichtbaar met voiceTokenUrl")
        pg.click("#voice-btn")
        pg.wait_for_function("window.__opts")
        pg.wait_for_timeout(100)
        o = pg.evaluate("({tok:__opts.conversationToken, ct:__opts.connectionType, "
                        "dv:__opts.dynamicVariables, tools:Object.keys(__opts.clientTools)})")
        check(o["tok"] == "tok" and o["ct"] == "webrtc", "token + WebRTC doorgegeven")
        check(o["dv"] == {"actief_merk": "CB - Leef (code: cbleef)"}, "actief_merk = geselecteerd merk")
        check(o["tools"] == ["open_pdf", "toon_antwoord"], "client-tools geregistreerd")
        check(pg.inner_text("#voice-status") == "Luistert…", "spraakbalk: Luistert…")

        pg.evaluate("__opts.onMessage({message:'Max LTV bij <Attens>?', role:'user'})")
        check("Max LTV bij <Attens>?" in pg.locator("#chat .message.user").last.inner_text(),
              "gesproken vraag als chatbericht (HTML ge-escaped)")
        pg.evaluate("__opts.onModeChange({mode:'speaking'}); __opts.onMessage({message:'Volgens Attens…', role:'agent'})")
        check(pg.inner_text("#voice-status") == "Spreekt…" and "Volgens Attens" in pg.inner_text("#voice-caption"),
              "ondertitel + Spreekt…")

        # open_pdf: juiste gids, pagina en markering (zin staat op pagina 10 van de Attens-gids)
        pg.evaluate("__opts.clientTools.open_pdf({merk:'attens', pdf_pagina:10, "
                    "zinsnede:'bedrijf niet gevestigd of actief in Nederland'})")
        check(pg.inner_text("#header-title") == "Attens", "open_pdf selecteert het merk")
        check("#page=10" in pg.get_attribute("#pdf-frame-wrap iframe", "src"), "PDF op pagina 10")
        pg.wait_for_timeout(5000)
        st = pg.evaluate("(()=>{const a=document.querySelector('#pdf-frame-wrap iframe').contentWindow"
                         ".PDFViewerApplication; return {hits:a.findController._matchesCountTotal, page:a.page}})()")
        check(st["hits"] and st["page"] == 10, f"zinsnede gevonden en gemarkeerd {st}")
        check(pg.evaluate("__conv.updates.length") == 0, "geen contextupdate bij merkwissel door de agent")

        pg.evaluate("__opts.clientTools.toon_antwoord({merk:'attens', tekst:'LTV is **100%** (pagina 22).'})")
        last = pg.locator("#chat .message.ai").last
        check("Spraakantwoord" in last.text_content() and last.locator(".page-jump-btn").count() == 1,
              "toon_antwoord: bericht met paginaknop")
        check("#page=10" in pg.get_attribute("#pdf-frame-wrap iframe", "src"), "toon_antwoord herlaadt de PDF niet")

        pg.click('.brand-item[data-key="syntrus"]')
        pg.wait_for_timeout(100)
        u = pg.evaluate("__conv.updates")
        check(len(u) == 1 and "Syntrus Achmea (code: syntrus)" in u[0], "contextupdate bij merkwissel door gebruiker")

        pg.evaluate("__opts.clientTools.toon_antwoord({merk:'alle', tekst:'| Merk | LTV |\\n|---|---|\\n| Attens | 100% |'})")
        check(pg.inner_text("#header-title") == "Alle merken" and pg.locator("#chat table").count() >= 1,
              "vergelijking: 'Alle merken' actief, tabel getoond")
        check(pg.evaluate("__opts.clientTools.open_pdf({merk:'abn', pdf_pagina:1})").startswith("Onbekend"),
              "onbekend merk afgevangen")

        pg.click("#voice-stop")
        pg.wait_for_timeout(100)
        check(pg.evaluate("window.__ended===true") and not pg.is_visible("#voice-bar"), "Stop beëindigt de sessie")
        check(not errs, f"geen JS-fouten {errs}")
        ctx.close()
    finally:
        page_file.unlink(missing_ok=True)
        srv.shutdown()


if __name__ == "__main__":
    with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
        opts = {"args": ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--no-sandbox"]}
        if os.environ.get("CHROME_PATH"):
            opts["executable_path"] = os.environ["CHROME_PATH"]
        browser = p.chromium.launch(**opts)
        test_pages(browser, tmp)
        test_flask_and_voice(browser)
        browser.close()
    print(f"\n{'ALLES GESLAAGD' if not failures else f'{len(failures)} MISLUKT'}")
    sys.exit(1 if failures else 0)
