# Van Render naar Supabase + GitHub Pages

Na deze overstap draait er geen server meer bij Render:

| Onderdeel | Was | Wordt |
|---|---|---|
| Website (HTML, JS, CSS, PDF.js, PDF's) | Flask op Render | **GitHub Pages** — `https://hgmhendrikx.github.io/AMA-Chatbot-Alle-Merken/` |
| `/ask` en `/ask-all` | Flask + LangGraph op Render | **Supabase Edge Function `ask`** (zelfde prompts, zelfde gpt-4.1, zelfde Pinecone-index) |
| Pinecone-index `hypotheek-docs` | — | ongewijzigd; `ingest.py` blijf je lokaal draaien als een gids verandert |

Geen koude start van 30+ seconden meer: Edge Functions starten in milliseconden.

## Wat er in de repo veranderd is

| Bestand | Wat |
|---|---|
| `supabase/functions/ask/index.ts` | Vervangt `/ask` en `/ask-all`. Zelfde agent-gedrag: gpt-4.1 met de tool `retrieve_context` (k=3, filter op merk), bronnen als "(pagina X)", synthese over alle merken. |
| `supabase/functions/_shared/retrieval.ts` | Gedeelde code: OpenAI-embeddings, Pinecone, CORS en toegangscode. |
| `supabase/config.toml` | Zet de standaard JWT-check uit; de functies regelen zelf de toegang. |
| `scripts/build_pages.py` | Bouwt de statische site uit `templates/index.html`, `brands.py` en `static/`. Eén frontend voor Render én Pages. |
| `pages.config.json` | De Supabase-URL's voor de Pages-versie. |
| `.github/workflows/pages.yml` | Bouwt en publiceert de site bij elke push naar `main`. |
| `static/js/main.js` | Relatieve paden; praat met Supabase als `APP_CONFIG.apiUrl` gezet is, anders met Flask. Vraagt eenmalig om de toegangscode als die vereist is. |
| `app.py`, `templates/index.html` | Geven `APP_CONFIG` door; Render blijft werken zoals nu. |

## Stap 1 — Supabase-functie deployen

Je hebt een Supabase-project nodig (het gratis plan volstaat).

```bash
npm i -g supabase
supabase login
supabase link --project-ref <PROJECT_REF>        # staat in de URL van je project-dashboard

supabase secrets set \
  OPENAI_API_KEY=sk-... \
  PINECONE_API_KEY=pcsk_... \
  ALLOWED_ORIGINS="https://hgmhendrikx.github.io"

supabase functions deploy ask --no-verify-jwt
```

Je kunt de secrets ook in het dashboard invullen: **Edge Functions → Secrets**.

**Toegangscode (aanbevolen).** De functie is publiek bereikbaar; met een code kan niet iedereen op jouw kosten vragen stellen:

```bash
supabase secrets set ACCESS_CODE=<kies een code>
```

De site vraagt er dan één keer om en onthoudt hem in de browser. Deel de code alleen met je adviseurs.

**Test:**

```bash
curl -s -X POST https://<PROJECT_REF>.supabase.co/functions/v1/ask \
  -H "Origin: https://hgmhendrikx.github.io" -H "Content-Type: application/json" \
  -H "x-access-code: <code>" \
  -d '{"query":"Wat is de maximale LTV?","brand":"attens"}'
```

Je krijgt `{"answer": "...(pagina X)...", "pages": [...]}` terug.

## Stap 2 — GitHub Pages aanzetten

1. Vul in `pages.config.json` je project-ref in bij `apiUrl`.
2. GitHub → repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push naar `main` (of start de workflow onder **Actions → Deploy naar GitHub Pages → Run workflow**).

Na een minuut staat de site op `https://hgmhendrikx.github.io/AMA-Chatbot-Alle-Merken/`.

## Stap 3 — Testen en Render uitzetten

Stel op de Pages-site dezelfde vragen als op Render, zowel per merk als bij "Alle merken". Komen de antwoorden overeen, dan kun je de Render-service pauzeren of verwijderen.

`app.py`, `Dockerfile` en `requirements.txt` kunnen daarna weg. Ze schaden niet als ze blijven staan; de Pages-build gebruikt ze niet.

## Kosten en limieten

- **Supabase (gratis plan):** 500.000 functie-aanroepen per maand. Een verzoek mag maximaal 150 seconden duren; een vraag over alle merken duurt meestal 15–40 seconden, dus dat past ruim. Let op: een gratis project wordt na 7 dagen zonder activiteit gepauzeerd en moet je dan in het dashboard weer starten. Wordt de assistent dagelijks gebruikt, dan merk je daar niets van.
- **OpenAI en Pinecone:** precies hetzelfde gebruik als nu.
- **GitHub Pages:** gratis voor publieke repo's. De repo is publiek, net als nu op Render: de PDF's zijn openbaar te downloaden.

## Problemen?

- **"Origin niet toegestaan"** → het domein waarop de site draait staat niet in `ALLOWED_ORIGINS`. Let op: zonder `/` aan het eind en zonder pad.
- **Foutmelding in de chat** → Supabase-dashboard → **Edge Functions → ask → Logs**.
- **Pages-build faalt met "vul 'apiUrl' in"** → `pages.config.json` bevat nog `<PROJECT_REF>`.
