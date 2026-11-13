// Supabase Edge Function: ask
// ------------------------------------------------------------------
// Vervangt de Flask-endpoints /ask en /ask-all uit app.py.
//
// POST { "query": "...", "brand": "attens" }     → { answer, pages }
// POST { "query": "...", "brand": "__all__" }    → { synthesis, brands: { key: { answer, pages } } }
//
// Werkt zoals de LangGraph ReAct-agent: gpt-4.1 krijgt een tool
// 'retrieve_context' (k=3, gefilterd op merk), mag die zelf aanroepen
// (ook meerdere keren, met een eigen zoekvraag) en antwoordt met
// bronvermelding "(pagina X)".
//
// Secrets: OPENAI_API_KEY, PINECONE_API_KEY, ALLOWED_ORIGINS
//          optioneel: PINECONE_INDEX_HOST, ACCESS_CODE, CHAT_MODEL
// ------------------------------------------------------------------
import { BRANDS, checkAccess, corsHeaders, embed, searchBrand } from "../_shared/retrieval.ts";

const MODEL = Deno.env.get("CHAT_MODEL") ?? "gpt-4.1";
const MAX_ROUNDS = 4; // tool-rondes per vraag

type Msg = Record<string, unknown>;

async function chat(messages: Msg[], tools?: unknown[]): Promise<any> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, ...(tools ? { tools } : {}) }),
  });
  if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${await res.text()}`);
  return (await res.json()).choices[0].message;
}

function systemPrompt(brandName: string): string {
  // Zelfde instructie als make_agent() in app.py
  return (
    `You have access to a tool that retrieves context from the acceptance policy of ${brandName}, ` +
    `a Dutch mortgage provider. Use the tool to answer user queries accurately. ` +
    `Always cite your sources using exactly this format: (pagina X) — where X is the page number. ` +
    `Use lowercase 'pagina' followed by a space and the number, always in parentheses. ` +
    `Example: 'De maximale LTV is 100% (pagina 22).' ` +
    `Never use abbreviations like 'pag.' or 'p.' or footnote markers. ` +
    `Answer in the same language as the question.`
  );
}

const RETRIEVE_TOOL = {
  type: "function",
  function: {
    name: "retrieve_context",
    description: "Retrieve information from the acceptance policy to answer a query.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

/** Zelfde regex als _extract_pages() in app.py */
export function extractPages(answer: string): number[] {
  const pages = new Set<number>();
  for (const m of answer.matchAll(/\(([^)]*pagina[^)]+)\)/gi)) {
    for (const n of m[1].matchAll(/\d+/g)) pages.add(parseInt(n[0], 10));
  }
  return [...pages].sort((a, b) => a - b);
}

async function runBrandAgent(brand: string, query: string): Promise<{ answer: string; pages: number[] }> {
  const messages: Msg[] = [
    { role: "system", content: systemPrompt(BRANDS[brand]) },
    { role: "user", content: query },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const msg = await chat(messages, [RETRIEVE_TOOL]);
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      const answer = msg.content || "Geen informatie gevonden.";
      return { answer, pages: extractPages(answer) };
    }
    for (const call of msg.tool_calls) {
      let q = query;
      try { q = JSON.parse(call.function.arguments).query || query; } catch { /* val terug op vraag */ }
      const docs = await searchBrand(await embed(q), brand, 3);
      // Zelfde opmaak als de Python-tool: "Source: {metadata}\nContent: {page_content}"
      const serialized = docs
        .map((d) => `Source: ${JSON.stringify(d.metadata)}\nContent: ${d.text}`)
        .join("\n\n");
      messages.push({ role: "tool", tool_call_id: call.id, content: serialized });
    }
  }
  // Te veel rondes: dwing een eindantwoord af zonder tools
  const final = await chat(messages);
  const answer = final.content || "Geen informatie gevonden.";
  return { answer, pages: extractPages(answer) };
}

async function askAll(query: string) {
  const keys = Object.keys(BRANDS);
  const results = await Promise.all(keys.map((k) => runBrandAgent(k, query)));
  const brands: Record<string, { answer: string; pages: number[] }> = {};
  keys.forEach((k, i) => (brands[k] = results[i]));

  const brandSummaries = keys.map((k) => `## ${BRANDS[k]}\n${brands[k].answer}`).join("\n\n");
  // Zelfde syntheseprompt als ask_all() in app.py
  const synthesisPrompt = `Je bent een expert hypotheekadviseur. Hieronder staan de antwoorden van 4 Nederlandse hypotheekverstrekkers op de volgende vraag:

Vraag: ${query}

${brandSummaries}

Geef een helder vergelijkend overzicht:
- Vergelijk de merken op de gestelde vraag en markeer overeenkomsten en verschillen.
- Als iets alleen bij één of enkele merken mogelijk is, benoem dat expliciet en geef daar meer detail over.
- Gebruik een tabel als dat de vergelijking verduidelijkt.
- Sluit af met een korte conclusie.
- Antwoord in dezelfde taal als de vraag.`;

  const synthesis = (await chat([{ role: "user", content: synthesisPrompt }])).content ?? "";
  return { synthesis, brands };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });

  if (req.method !== "POST") return reply({ error: "Gebruik POST" }, 405);
  const denied = checkAccess(req);
  if (denied) return reply({ error: denied[1], answer: denied[1] }, denied[0]);

  let data: any;
  try { data = await req.json(); } catch { return reply({ error: "Ongeldige JSON" }, 400); }
  const query = String(data?.query ?? "").trim();
  const brand = String(data?.brand ?? "").trim();

  if (!query) return reply({ answer: "Geen vraag ontvangen.", error: "Geen vraag ontvangen." }, 400);

  try {
    if (brand === "__all__") {
      console.log(`[ASK-ALL] ${query}`);
      return reply(await askAll(query));
    }
    if (!(brand in BRANDS)) return reply({ answer: "Onbekend merk geselecteerd." }, 400);
    console.log(`[ASK] ${brand}: ${query}`);
    const r = await runBrandAgent(brand, query);
    return reply({ answer: r.answer || "Geen antwoord ontvangen.", pages: r.pages });
  } catch (e) {
    console.error(e);
    const msg = `Fout: ${(e as Error).message}`;
    return reply({ answer: msg, error: msg }, 500);
  }
});
