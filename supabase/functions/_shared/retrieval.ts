// Gedeelde code voor de Edge Functions: merken, OpenAI-embeddings en Pinecone.
// Moet overeenkomen met brands.py en ingest.py (index "hypotheek-docs",
// embeddingmodel text-embedding-3-large, metadata-veld "brand").

export const INDEX_NAME = "hypotheek-docs";
export const EMBED_MODEL = "text-embedding-3-large";

export const BRANDS: Record<string, string> = {
  cbleef: "CB - Leef",
  attens: "Attens",
  syntrus: "Syntrus Achmea",
  cbwoningverhuur: "CB - Woningverhuur",
};

export type Chunk = {
  text: string;
  metadata: Record<string, unknown>; // zonder 'text'
  score: number;
};

let cachedHost: string | null = Deno.env.get("PINECONE_INDEX_HOST") ?? null;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Secret ${name} ontbreekt`);
  return v;
}

export async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

export async function pineconeHost(): Promise<string> {
  if (cachedHost) return cachedHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const res = await fetch(`https://api.pinecone.io/indexes/${INDEX_NAME}`, {
    headers: { "Api-Key": env("PINECONE_API_KEY"), "X-Pinecone-API-Version": "2025-04" },
  });
  if (!res.ok) throw new Error(`Pinecone describe_index ${res.status}: ${await res.text()}`);
  cachedHost = (await res.json()).host as string;
  return cachedHost;
}

/** Zoekt de k meest relevante chunks voor één merk. */
export async function searchBrand(vector: number[], brand: string, k: number): Promise<Chunk[]> {
  const host = await pineconeHost();
  const res = await fetch(`https://${host}/query`, {
    method: "POST",
    headers: {
      "Api-Key": env("PINECONE_API_KEY"),
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2025-04",
    },
    body: JSON.stringify({
      vector,
      topK: k,
      filter: { brand: { $eq: brand } },
      includeMetadata: true,
    }),
  });
  if (!res.ok) throw new Error(`Pinecone query ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.matches ?? []).map((m: any) => {
    const { text, ...metadata } = m.metadata ?? {};
    return { text: String(text ?? ""), metadata, score: m.score ?? 0 };
  });
}

/** Fysiek (1-based) en gedrukt paginanummer uit de PyPDFLoader-metadata. */
export function pageInfo(md: Record<string, unknown>): { label: string; physical: number } {
  const physical = Number(md.page ?? 0) + 1;
  const raw = md.page_label;
  const label = raw != null && String(raw).trim() !== "" ? String(raw) : String(physical);
  return { label, physical };
}

// ── CORS + toegangscontrole (gedeeld door ask en elevenlabs-token) ──
export function allowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
}

export function corsHeaders(origin: string | null, methods = "POST, OPTIONS"): Record<string, string> {
  const ok = origin && allowedOrigins().includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "null",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "content-type, x-access-code",
    "Vary": "Origin",
  };
}

/** null = toegestaan; anders [status, melding]. */
export function checkAccess(req: Request, codeFromQuery = false): [number, string] | null {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return [403, "Origin niet toegestaan"];
  const code = Deno.env.get("ACCESS_CODE") ?? Deno.env.get("VOICE_ACCESS_CODE");
  if (code) {
    const given = codeFromQuery
      ? new URL(req.url).searchParams.get("code")
      : req.headers.get("x-access-code");
    if (given !== code) return [401, "Ongeldige toegangscode"];
  }
  return null;
}
