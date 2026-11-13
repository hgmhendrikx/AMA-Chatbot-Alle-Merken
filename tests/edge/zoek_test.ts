// Draaien: deno run -A tests/edge/zoek_test.ts  (bootst OpenAI en Pinecone na; geen sleutels nodig)
const calls: any[] = [];
let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
  if (url.includes("api.openai.com")) return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }));
  if (url.includes("api.pinecone.io/indexes")) return new Response(JSON.stringify({ host: "hypotheek-docs-abc.svc.pinecone.io" }));
  if (url.endsWith("/query")) {
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify({ matches: [
      { score: 0.81234, metadata: { brand: b.filter.brand.$eq, page: 21, page_label: "22", text: "De maximale   LTV\nbedraagt 100% van de marktwaarde." } },
      { score: 0.7, metadata: { brand: b.filter.brand.$eq, page: 4, text: "x".repeat(1200) } },
    ]}));
  }
  throw new Error("unexpected " + url);
}) as any;
Deno.env.set("VOICE_TOOL_SECRET", "s3cret");
Deno.env.set("OPENAI_API_KEY", "o"); Deno.env.set("PINECONE_API_KEY", "p");
await import("../../supabase/functions/zoek-acceptatiebeleid/index.ts");
const post = (body: any, secret = "s3cret") => handler!(new Request("http://x/", { method: "POST", headers: { "x-tool-secret": secret }, body: JSON.stringify(body) }));
const assert = (c: boolean, m: string) => { if (!c) throw new Error("FAIL " + m); console.log("ok", m); };

let r = await post({ merk: "attens", vraag: "ltv" }, "fout"); assert(r.status === 401, "verkeerd secret -> 401");
r = await post({ merk: "abn", vraag: "ltv" }); assert(r.status === 400, "onbekend merk -> 400");
r = await post({ merk: "attens" }); assert(r.status === 400, "geen vraag -> 400");
r = await post({ merk: "Syntrus Achmea", vraag: "maximale ltv" });
let j = await r.json();
assert(r.status === 200 && j.merk === "syntrus", "alias 'Syntrus Achmea' -> syntrus");
assert(j.resultaten[0].pagina === "22" && j.resultaten[0].pdf_pagina === 22, "page_label 22, pdf_pagina 22");
assert(j.resultaten[1].pagina === "5" && j.resultaten[1].pdf_pagina === 5, "zonder page_label -> fysieke pagina");
assert(j.resultaten[0].tekst === "De maximale LTV bedraagt 100% van de marktwaarde.", "witruimte genormaliseerd");
assert(j.resultaten[1].tekst.length === 901, "lange tekst ingekort");
const q = calls.filter(c => c.url.endsWith("/query"));
assert(q[0].url === "https://hypotheek-docs-abc.svc.pinecone.io/query" && q[0].body.topK === 4, "host opgezocht, topK 4");
calls.length = 0;
r = await post({ merk: "alle", vraag: "ltv" }); j = await r.json();
const qs = calls.filter(c => c.url.endsWith("/query"));
assert(qs.length === 4 && new Set(qs.map(c => c.body.filter.brand.$eq)).size === 4 && qs[0].body.topK === 3, "alle -> 4 merken, topK 3");
assert(calls.filter(c => c.url.includes("openai")).length === 1, "één embedding voor alle merken");
assert(!calls.some(c => c.url.includes("api.pinecone.io/indexes")), "host gecachet");
assert(j.resultaten.length === 8, "8 resultaten");
r = await handler!(new Request("http://x/", { method: "GET" })); assert(r.status === 405, "GET -> 405");
