# Spraakmodus (ElevenLabs) — installatie

De adviseur klikt op de microfoon naast het invoerveld en stelt zijn vraag hardop. Een ElevenLabs-agent zoekt in de acceptatiegidsen (via dezelfde Pinecone-index als de chat), geeft kort gesproken antwoord met merk en pagina, zet de uitgeschreven versie in de chat en opent de PDF op de juiste pagina met de passage geel gemarkeerd.

```
Browser (microfoon)                 ElevenLabs Agent                   Supabase Edge Functions
──────────────────                  ────────────────                   ───────────────────────
1. klik 🎙  ───── token ophalen ─────────────────────────────────────▶ elevenlabs-token
2. WebRTC-gesprek ◀──────────────▶  spraak → tekst → LLM → stem
                                    3. webhook ───────────────────────▶ zoek-acceptatiebeleid
                                                                         → OpenAI embedding
                                                                         → Pinecone (hypotheek-docs)
4. client-tools ◀───────────────── open_pdf / toon_antwoord
   (PDF + markering, chatbericht)
```

De chat blijft gewoon werken; spraak is een extra ingang. Zie `MIGRATIE.md` voor de overstap van Render naar Supabase + GitHub Pages; deze handleiding gaat ervan uit dat die gedaan is (de secrets `OPENAI_API_KEY`, `PINECONE_API_KEY` en `ALLOWED_ORIGINS` staan dan al in Supabase).

## Bestanden

| Bestand | Wat |
|---|---|
| `supabase/functions/zoek-acceptatiebeleid/index.ts` | Webhook-tool: zoekt passages + paginanummers in Pinecone |
| `supabase/functions/elevenlabs-token/index.ts` | Geeft de browser een kortlevend gesprekstoken (API-sleutel blijft op de server) |
| `supabase/config.toml` | Zet de standaard JWT-check uit voor deze twee functies |
| `elevenlabs/systeemprompt.md` | Systeemprompt, eerste bericht en dynamische variabele voor de agent |
| `elevenlabs/tools/*.json` | Definities van de drie tools (ook bruikbaar via de ElevenLabs API) |
| `static/js/voice.js` | Microfoonknop, gesprek, client-tools |
| `static/css/voice.css` | Opmaak microfoonknop en spraakbalk |
| `templates/index.html` | Microfoonknop en spraakbalk toegevoegd |
| `pages.config.json` | `voiceTokenUrl` zet de microfoonknop aan op GitHub Pages |

---

## Stap 1 — Supabase: webhook-geheim en functies

```bash
# geheim voor de webhook verzinnen (bewaar de uitkomst, die heb je in stap 2 nodig)
openssl rand -hex 32
supabase secrets set VOICE_TOOL_SECRET=<uitkomst van openssl>

supabase functions deploy zoek-acceptatiebeleid --no-verify-jwt
supabase functions deploy elevenlabs-token --no-verify-jwt
```

**Test:**

```bash
curl -s -X POST https://<PROJECT_REF>.supabase.co/functions/v1/zoek-acceptatiebeleid \
  -H "x-tool-secret: <VOICE_TOOL_SECRET>" -H "Content-Type: application/json" \
  -d '{"merk":"attens","vraag":"maximale LTV bij aankoop"}' | head -c 600
```

Je hoort een JSON terug te krijgen met `resultaten` (merk, pagina, pdf_pagina, tekst).

## Stap 2 — ElevenLabs: agent aanmaken

In [elevenlabs.io](https://elevenlabs.io) → **Agents** → **Create agent** → **Blank template**.

**Agent-tab**
- **Agent language:** Dutch.
- **First message** en **System prompt**: kopieer uit `elevenlabs/systeemprompt.md`.
- **Dynamic variables:** `actief_merk`, standaardwaarde `geen`.
- **LLM:** kies een snel model uit de lijst. Hoe sneller het model, hoe natuurlijker het gesprek; een groter model geeft betere vergelijkingen. Test beide met je eigen vragen.

**Voice-tab**
- Kies een Nederlandse stem (filter in de Voice Library op Dutch).

**Secrets** (Workspace → Secrets of bij het toevoegen van een header)
- Maak een secret `VOICE_TOOL_SECRET` met dezelfde waarde als in Supabase.

**Tools → Add tool → Webhook** — waarden uit `elevenlabs/tools/zoek_acceptatiebeleid.json`:
- Name `zoek_acceptatiebeleid`, description zoals in het bestand.
- Method `POST`, URL `https://<PROJECT_REF>.supabase.co/functions/v1/zoek-acceptatiebeleid`.
- Header `x-tool-secret`, type **Secret** → `VOICE_TOOL_SECRET`.
- Body parameters: `merk` (string, enum `cbleef, attens, syntrus, cbwoningverhuur, alle`) en `vraag` (string), beide verplicht, met de beschrijvingen uit het bestand.
- Zet **Pre-tool speech** aan (de agent zegt dan "even kijken…" terwijl hij zoekt). Timeout 20 s.

**Tools → Add tool → Client** — twee keer, uit `open_pdf.json` en `toon_antwoord.json`:
- Namen exact `open_pdf` en `toon_antwoord` (hoofdlettergevoelig).
- Parameters zoals in de bestanden.
- **Wait for response:** uit.

**Security-tab**
- Zet **Enable authentication** aan. Dan kan alleen iemand met een token van jouw `elevenlabs-token`-functie praten.
- Vul bij **Allowlist** je domeinen in (Render-URL en later GitHub Pages).

**Privacy / Advanced**
- Stel de bewaartermijn van gesprekken in (bv. 30 dagen of korter). Spreek met adviseurs af dat ze geen klantnamen of BSN's noemen.

Kopieer daarna het **Agent ID** (`agent_...`).

## Stap 3 — Token-functie koppelen

Maak in ElevenLabs een API-sleutel aan met alleen rechten op **ElevenAgents** (Settings → API keys → beperk de scope).

```bash
supabase secrets set ELEVENLABS_API_KEY=sk_... ELEVENLABS_AGENT_ID=agent_...
```

De toegestane domeinen (`ALLOWED_ORIGINS`) en de optionele toegangscode (`ACCESS_CODE`) zijn dezelfde als voor de chat; die staan er al.

## Stap 4 — Microfoonknop aanzetten

- **GitHub Pages:** vul in `pages.config.json` `voiceTokenUrl` in met `https://<PROJECT_REF>.supabase.co/functions/v1/elevenlabs-token` en push naar `main`. De workflow publiceert de site opnieuw.
- **Render (zolang die nog draait):** zet de omgevingsvariabele `VOICE_TOKEN_URL` op dezelfde URL en voeg je Render-domein toe aan `ALLOWED_ORIGINS`.

Is de URL leeg, dan is de microfoonknop verborgen.

## Stap 5 — Testen

Open de site, klik op 🎙, sta de microfoon toe en probeer:

1. *Selecteer Attens* → "Wat is de maximale LTV?" → kort gesproken antwoord, antwoord in de chat, PDF opent met markering.
2. *Geen merk geselecteerd* → "Hoe kijkt Syntrus naar flexibel inkomen?" → agent kiest zelf Syntrus.
3. "Vergelijk alle merken op tijdelijk contract" → korte gesproken kern, tabel in de chat.
4. Tijdens het gesprek in de zijbalk een ander merk aanklikken → vervolgvraag gaat over het nieuwe merk.
5. "Open de gids van CB Leef op die pagina" → PDF wisselt.

Problemen? Kijk in Supabase → Edge Functions → Logs (regel `[voice] merk=… hits=…`) en in ElevenLabs → Conversations (je ziet per gesprek welke tools zijn aangeroepen en wat ze teruggaven).

## Bekende beperkingen

- **Paginanummers:** de agent noemt het gedrukte paginanummer als de PDF paginalabels heeft, anders het fysieke nummer. `open_pdf` gebruikt altijd het fysieke nummer, dus de PDF springt naar de juiste pagina.
- **Markering:** werkt alleen als de zinsnede letterlijk in de PDF-tekst staat; anders probeert de viewer de eerste zes woorden. Lukt dat ook niet, dan opent de juiste pagina zonder markering.
- **Kosten:** ElevenLabs rekent per gespreksminuut, plus het gekozen LLM. Per vraag komt daar één OpenAI-embedding bij (verwaarloosbaar).
