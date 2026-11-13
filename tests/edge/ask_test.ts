// Draaien: deno run -A tests/edge/ask_test.ts  (bootst OpenAI en Pinecone na; geen sleutels nodig)
let handler: any; (Deno as any).serve = (h: any) => { handler = h; };
const log: any[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input); const body = init?.body ? JSON.parse(init.body) : null; log.push({ url, body });
  if (url.includes("/embeddings")) return new Response(JSON.stringify({ data: [{ embedding: [1] }] }));
  if (url.includes("api.pinecone.io/indexes")) return new Response(JSON.stringify({ host: "h.pinecone.io" }));
  if (url.endsWith("/query")) return new Response(JSON.stringify({ matches: [{ score: .9, metadata: { brand: body.filter.brand.$eq, page: 21, page_label: "22", text: "LTV max 100%" } }] }));
  if (url.includes("/chat/completions")) {
    const sys = body.messages[0].content as string;
    if (!body.tools) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "| Merk | LTV |\n|---|---|\n| Attens | 100% |" } }] }));
    const hasTool = body.messages.some((m: any) => m.role === "tool");
    if (!hasTool) return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "retrieve_context", arguments: JSON.stringify({ query: "maximale LTV" }) } }] } }] }));
    const name = sys.match(/policy of (.+?),/)![1];
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: `${name}: max LTV 100% (pagina 22, 30).` } }] }));
  }
  throw new Error("unexpected " + url);
}) as any;
Deno.env.set("ALLOWED_ORIGINS", "https://hgmhendrikx.github.io");
Deno.env.set("OPENAI_API_KEY", "o"); Deno.env.set("PINECONE_API_KEY", "p");
await import("../../supabase/functions/ask/index.ts");
const a = (c: boolean, m: string) => { if (!c) throw new Error("FAIL " + m); console.log("ok", m); };
const post = (b: any, origin = "https://hgmhendrikx.github.io", hdr: any = {}) => handler(new Request("http://f/", { method: "POST", headers: { origin, ...hdr }, body: JSON.stringify(b) }));
let r = await post({ query: "x", brand: "attens" }, "https://evil.com"); a(r.status === 403, "vreemde origin -> 403");
r = await post({ query: "", brand: "attens" }); a(r.status === 400 && (await r.json()).answer === "Geen vraag ontvangen.", "lege vraag");
r = await post({ query: "x", brand: "abn" }); a(r.status === 400, "onbekend merk");
r = await post({ query: "Wat is de max LTV?", brand: "attens" }); let j = await r.json();
a(r.status === 200 && j.answer === "Attens: max LTV 100% (pagina 22, 30)." && JSON.stringify(j.pages) === "[22,30]", "enkel merk: antwoord + pages [22,30]");
a(r.headers.get("access-control-allow-origin") === "https://hgmhendrikx.github.io", "CORS");
const toolMsg = log.filter(l => l.url.includes("chat")).at(-1).body.messages.find((m: any) => m.role === "tool");
a(toolMsg.content.startsWith('Source: {"brand":"attens","page":21,"page_label":"22"}\nContent: LTV max 100%'), "tool-output in Python-formaat");
a(log.find(l => l.url.includes("embeddings")).body.input === "maximale LTV", "agent's eigen zoekvraag gebruikt");
a(log.find(l => l.url.includes("chat")).body.model === "gpt-4.1", "model gpt-4.1");
log.length = 0;
r = await post({ query: "Vergelijk LTV", brand: "__all__" }); j = await r.json();
a(Object.keys(j.brands).join() === "cbleef,attens,syntrus,cbwoningverhuur", "alle 4 merken");
a(j.brands.syntrus.answer.startsWith("Syntrus Achmea") && j.brands.syntrus.pages.length === 2, "per merk antwoord + pages");
a(j.synthesis.includes("| Attens | 100% |"), "synthese");
const synth = log.filter(l => l.url.includes("chat") && !l.body.tools)[0].body.messages[0].content;
a(synth.includes("## CB - Woningverhuur\nCB - Woningverhuur: max LTV") && synth.includes("Vraag: Vergelijk LTV"), "syntheseprompt bevat alle merken");
Deno.env.set("ACCESS_CODE", "42");
r = await post({ query: "x", brand: "attens" }); a(r.status === 401, "code vereist");
r = await post({ query: "x", brand: "attens" }, undefined, { "x-access-code": "42" }); a(r.status === 200, "juiste code");
r = await handler(new Request("http://f/", { method: "OPTIONS", headers: { origin: "https://hgmhendrikx.github.io" } }));
a(r.status === 204 && r.headers.get("access-control-allow-headers")!.includes("x-access-code"), "preflight staat x-access-code toe");
