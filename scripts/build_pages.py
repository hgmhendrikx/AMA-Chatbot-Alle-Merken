"""Bouwt de statische site voor GitHub Pages in _site/.

Gebruikt dezelfde bronbestanden als de Flask-app, zodat er maar één versie
van de frontend is:
  templates/index.html  → _site/index.html (Jinja-variabelen ingevuld)
  brands.py             → BRANDS in de pagina (pdf-paden relatief gemaakt)
  pages.config.json     → APP_CONFIG (Supabase-URL's)
  static/               → _site/static/ (zonder sourcemaps en PDF.js-voorbeeld)

Gebruik:  python scripts/build_pages.py [uitvoermap]
          PAGES_CONFIG=pad/naar/config.json python scripts/build_pages.py   (andere config, bv. in tests)
"""
import json
import os
import shutil
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"

sys.path.insert(0, str(ROOT))
from brands import BRANDS  # noqa: E402

config_path = Path(os.environ.get("PAGES_CONFIG", ROOT / "pages.config.json"))
config = json.loads(config_path.read_text(encoding="utf-8"))
api_url = (config.get("apiUrl") or "").strip()
if not api_url or "<PROJECT_REF>" in api_url:
    sys.exit("pages.config.json: vul 'apiUrl' in met de URL van je Supabase-functie 'ask'.")
voice_url = (config.get("voiceTokenUrl") or "").strip() or None
if voice_url and "<PROJECT_REF>" in voice_url:
    voice_url = None

brands_json = json.dumps({
    k: {
        "name":    v["name"],
        "color":   v["color"],
        "accent":  v["accent"],
        "icon":    v["icon"],
        "pdf_url": v["pdf_url"].lstrip("/"),  # relatief: werkt onder /<repo>/
    }
    for k, v in BRANDS.items()
}, ensure_ascii=False)
app_config = json.dumps({"apiUrl": api_url, "voiceTokenUrl": voice_url})


def url_for(endpoint, filename):
    assert endpoint == "static"
    return f"static/{filename}"


env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=False)
html = env.get_template("index.html").render(
    url_for=url_for, brands_json=brands_json, app_config=app_config
)

if OUT.exists():
    shutil.rmtree(OUT)
shutil.copytree(
    ROOT / "static", OUT / "static",
    ignore=shutil.ignore_patterns("*.map", "compressed.tracemonkey-pldi-09.pdf"),
)
(OUT / "index.html").write_text(html, encoding="utf-8")
(OUT / ".nojekyll").write_text("")

size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file()) / 1e6
print(f"Site gebouwd in {OUT} ({size:.1f} MB)")
print(f"  apiUrl        = {api_url}")
print(f"  voiceTokenUrl = {voice_url or '(uit)'}")
