// Supabase Edge Function: zoek-acceptatiebeleid
// ------------------------------------------------------------------
// Webhook-tool voor de ElevenLabs voice-agent. Zoekt in dezelfde
// Pinecone-index als de chat ("hypotheek-docs") en geeft de relevante
// passages met paginanummers terug. De agent formuleert zelf het
// gesproken antwoord; deze functie roept dus geen chatmodel aan
// (scheelt een LLM-ronde = snellere reactie in een spraakgesprek).
//
// Request  (POST, JSON):  { "merk": "attens" | ... | "alle", "vraag": "..." }
// Header:                 x-tool-secret: <VOICE_TOOL_SECRET>
// Response (JSON):        { resultaten: [{ merk, merknaam, pagina, pdf_pagina, tekst }] }
//
// Secrets (supabase secrets set ...):
//   OPENAI_API_KEY, PINECONE_API_KEY, VOICE_TOOL_SECRET
//   PINECONE_INDEX_HOST  (optioneel; anders wordt hij opgezocht)
// ------------------------------------------------------------------

import { BRANDS, embed, pageInfo, pineconeHost, searchBrand } from "../_shared/retrieval.ts";

// Ook gesproken varianten accepteren, voor het geval het model die doorgeeft
const ALIASES: Record<string, string> = {
  leef: "cbleef",
  "cb leef": "cbleef",
  "cb - leef": "cbleef",
  "syntrus achmea": "syntrus",
  achmea: "syntrus",
  woningverhuur: "cbwoningverhuur",
  "cb woningverhuur": "cbwoningverhuur",
  "cb - woningverhuur": "cbwoningverhuur",
  "alle merken": "alle",
  alles: "alle",
};

const MAX_TEXT = 900; // tekens per passage: genoeg context, klein genoeg voor snelle verwerking

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function normaliseerMerk(raw: unknown): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "alle" || v in BRANDS) return v;
  return ALIASES[v] ?? null;
}

type Hit = {
  merk: string;
  merknaam: string;
  pagina: string;      // paginanummer zoals in de gids gedrukt (voor uitspreken)
  pdf_pagina: number;  // fysieke pagina in het PDF-bestand (voor open_pdf)
  tekst: string;
  score: number;
};

async function zoekPerMerk(vector: number[], merk: string, topK: number): Promise<Hit[]> {
  const chunks = await searchBrand(vector, merk, topK);
  return chunks.map((c) => {
    const { label, physical } = pageInfo(c.metadata);
    const tekst = c.text.replace(/\s+/g, " ").trim();
    return {
      merk,
      merknaam: BRANDS[merk],
      pagina: label,
      pdf_pagina: physical,
      tekst: tekst.length > MAX_TEXT ? tekst.slice(0, MAX_TEXT) + "…" : tekst,
      score: Math.round(c.score * 1000) / 1000,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ fout: "Gebruik POST" }, 405);

  const secret = Deno.env.get("VOICE_TOOL_SECRET");
  if (!secret || req.headers.get("x-tool-secret") !== secret) {
    return json({ fout: "Niet geautoriseerd" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ fout: "Ongeldige JSON" }, 400);
  }

  const vraag = String(body?.vraag ?? "").trim();
  const merk = normaliseerMerk(body?.merk);
  if (!vraag) return json({ fout: "Parameter 'vraag' ontbreekt" }, 400);
  if (!merk) {
    return json({
      fout: "Onbekend merk",
      geldige_merken: [...Object.keys(BRANDS), "alle"],
    }, 400);
  }

  try {
    const [vector] = await Promise.all([embed(vraag), pineconeHost()]);

    const merken = merk === "alle" ? Object.keys(BRANDS) : [merk];
    const topK = merk === "alle" ? 3 : 4;
    const perMerk = await Promise.all(
      merken.map((m) => zoekPerMerk(vector, m, topK)),
    );

    const resultaten = perMerk.flat();
    console.log(`[voice] merk=${merk} vraag="${vraag}" hits=${resultaten.length}`);

    return json({
      vraag,
      merk,
      aantal: resultaten.length,
      resultaten,
      instructie:
        "Baseer je antwoord uitsluitend op deze passages. Noem bij elke bewering het merk en de pagina " +
        "(veld 'pagina'). Gebruik 'pdf_pagina' als je open_pdf aanroept. Staat het antwoord er niet in, zeg dat dan.",
    });
  } catch (e) {
    console.error(e);
    return json({ fout: "Zoeken mislukt, probeer het opnieuw." }, 502);
  }
});
