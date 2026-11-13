# Hypotheek Acceptatie Assistent

Chatbot voor Nederlandse hypotheekadviseurs: vragen over het acceptatiebeleid van vier geldverstrekkers (CB - Leef, Attens, Syntrus Achmea, CB - Woningverhuur). Antwoorden komen uit de officiële acceptatiegidsen (PDF), met bronvermelding "(pagina X)" en een PDF-viewer die naar de juiste pagina springt. Er is ook een spraakmodus via ElevenLabs.

UI-teksten, prompts en documentatie zijn in het **Nederlands**; code-identifiers mogen Engels zijn (bestaande code mengt beide — volg het bestand waarin je werkt).

## Architectuur

```
GitHub Pages (statisch)                         Supabase Edge Functions (Deno/TypeScript)
  index.html  ← templates/index.html             ask                     chat: per merk of '__all__'
  static/js/main.js   chat, PDF-viewer   ──POST──▶  gpt-4.1 + tool retrieve_context (k=3)
  static/js/voice.js  spraak (optioneel) ──GET───▶ elevenlabs-token        kortlevend gesprekstoken
  static/pdfjs/       PDF.js (vendored)          zoek-acceptatiebeleid   webhook-tool voor de spraakagent
  static/pdfs/        de vier gidsen             _shared/retrieval.ts    OpenAI-embeddings, Pinecone, CORS
                                                          │
ElevenLabs Agent ──webhook──▶ zoek-acceptatiebeleid      ▼
      └─client-tools (open_pdf, toon_antwoord)──▶ voice.js     Pinecone-index "hypotheek-docs"
                                                               (gevuld door ingest.py, lokaal)
```

- **Legacy, nog actief:** `app.py` (Flask + LangGraph) draait op Render vanaf `main` via de `Dockerfile`. Dezelfde frontend werkt daar ook: zonder `APP_CONFIG.apiUrl` praat `main.js` met Flask `/ask` en `/ask-all`. Breek die modus niet zolang Render nog draait (zie `MIGRATIE.md`).
- **Eén frontend, twee hosts:** `templates/index.html` is de enige bron. Flask rendert hem met Jinja; `scripts/build_pages.py` rendert hem voor Pages. Gebruik daarom altijd **relatieve paden** (`static/...`, nooit `/static/...`): Pages serveert onder `/AMA-Chatbot-Alle-Merken/`.
- **Configuratie in de pagina:** `window.APP_CONFIG = { apiUrl, voiceTokenUrl }`. Bij Pages komt die uit `pages.config.json`, bij Flask uit `app.py` (`VOICE_TOKEN_URL`). Een lege `voiceTokenUrl` verbergt de microfoonknop.

## Belangrijke bestanden

| Pad | Rol |
|---|---|
| `brands.py` | Merken: naam, kleuren, icoon, PDF-pad. Bron voor Flask, `build_pages.py` en `ingest.py`. |
| `ingest.py` | Leest de PDF's, knipt ze in chunks (1000/200) en zet ze in Pinecone met metadata `brand`. Draai lokaal na een nieuwe gids. |
| `static/js/main.js` | Klassiek script (geen module). Globals `BRANDS`, `activeBrand`, `selectBrand`, `jumpToPage`, `addMessage`, `formatAnswer`, … worden door `voice.js` gebruikt; hernoem ze niet zonder `voice.js` mee te nemen. |
| `static/js/voice.js` | ES-module. Laadt `@elevenlabs/client` (vaste versie) van jsDelivr. Wikkelt `selectBrand` en `selectAllBrands` in om merkwissels aan de agent door te geven. |
| `supabase/functions/ask/index.ts` | Port van `app.py`. Prompts en paginaregex zijn bewust identiek; houd ze gelijk zolang Flask nog draait. |
| `supabase/functions/_shared/retrieval.ts` | `BRANDS`-codes, embeddings, Pinecone-query, `pageInfo`, CORS en `checkAccess` (`ALLOWED_ORIGINS`, `ACCESS_CODE`). |
| `elevenlabs/` | Systeemprompt en tooldefinities van de spraakagent. Die staan in het ElevenLabs-dashboard; deze bestanden zijn de referentie. |
| `static/pdfjs/` | Vendored PDF.js-build. **Niet bewerken.** |
| `MIGRATIE.md`, `VOICE.md` | Handleidingen voor de gebruiker (deploy, secrets, ElevenLabs instellen). |
| `chatbot-restructured.zip` | Oud archief, niet gebruikt. |

## Commando's

```bash
./scripts/test.sh            # alle tests (geen sleutels nodig; alle externe API's worden nagebootst)
./scripts/test.sh edge       # alleen Edge Functions: typecheck + tests/edge/*_test.ts
./scripts/test.sh ui         # alleen browsertest (Playwright): Pages-build, Flask-modus, spraakmodus

python scripts/build_pages.py            # site bouwen in _site/ (vereist echte apiUrl in pages.config.json)
python -m http.server -d _site 8000      # lokaal bekijken

supabase functions deploy ask --no-verify-jwt
supabase functions deploy zoek-acceptatiebeleid --no-verify-jwt
supabase functions deploy elevenlabs-token --no-verify-jwt
supabase functions logs ask

python ingest.py             # Pinecone opnieuw vullen (OPENAI_API_KEY + PINECONE_API_KEY in env)
```

Vereisten voor de tests: `deno`, `python3` met `playwright` en `jinja2`, plus Chromium (`python -m playwright install chromium`, of `CHROME_PATH=/pad/naar/chrome`). Draai na elke wijziging aan `main.js`, `voice.js`, de template of een Edge Function `./scripts/test.sh`.

Deploy: een push naar `main` publiceert de site via `.github/workflows/pages.yml`. Render deployt ook vanaf `main`.

## Valkuilen

- **Paginanummers.** PyPDFLoader slaat `page` 0-based op. `page_label` is het gedrukte nummer, als de PDF dat heeft. De chat citeert wat het model in de metadata ziet. `open_pdf` gebruikt `pdf_pagina` (fysiek, 1-based); PDF.js `#page=` is ook fysiek en 1-based.
- **Citaatformaat.** Exact `(pagina X)`, kleine letters. `extractPages` in `main.js` en `ask/index.ts` (en `_extract_pages` in `app.py`) leunen op deze regex. Verander het formaat nooit op één plek alleen.
- **`addMessage` met pages springt automatisch naar de PDF** als het paneel open is. `toon_antwoord` geeft daarom bewust `[]` mee en voegt de paginaknoppen zelf toe, anders verdwijnt de markering van `open_pdf`.
- **PDF-markering** gaat via `PDFViewerApplication.eventBus.dispatch('find', …)` in de same-origin iframe. Wacht tot `app.page` op de doelpagina staat, want PDF.js zoekt vanaf de huidige pagina.
- **Edge Functions:** maximaal 2 s CPU per verzoek en 150 s wall clock op het gratis plan. Wachten op `fetch` telt niet mee als CPU. Doe geen zware parsing in de functie.
- **`verify_jwt = false`** (in `supabase/config.toml`) is bewust. Beveiliging loopt via `ALLOWED_ORIGINS`, de optionele `ACCESS_CODE` en `x-tool-secret` (webhook). Origin-checks houden alleen browsers tegen; voor echte afscherming is `ACCESS_CODE` nodig.
- **Secrets nooit in de repo.** Ze horen in Supabase secrets, ElevenLabs secrets of de Render-env. `.env` staat in `.gitignore`.

## Een merk toevoegen of wijzigen

De merk-code moet op al deze plekken gelijk zijn:

1. `brands.py` (en de PDF in `static/pdfs/`).
2. `supabase/functions/_shared/retrieval.ts` → `BRANDS`.
3. `supabase/functions/zoek-acceptatiebeleid/index.ts` → `ALIASES` (gesproken varianten).
4. `elevenlabs/tools/*.json` → de `enum`s, en daarna dezelfde wijziging in het ElevenLabs-dashboard.
5. `elevenlabs/systeemprompt.md` → de merkenlijst.
6. `python ingest.py` draaien (let op: dit voegt toe en vervangt niets — verwijder oude vectoren van dat merk eerst in Pinecone).
7. In `ask/index.ts` noemt de syntheseprompt "4 Nederlandse hypotheekverstrekkers"; pas het aantal aan.
