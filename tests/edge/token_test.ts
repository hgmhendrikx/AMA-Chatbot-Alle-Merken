// Draaien: deno run -A tests/edge/token_test.ts  (bootst de ElevenLabs-API na)
let handler: any; (Deno as any).serve = (h: any) => { handler = h; };
let seen = "";
globalThis.fetch = (async (u: any, init: any) => { seen = String(u) + " key=" + init.headers["xi-api-key"]; return new Response(JSON.stringify({ token: "tok123" })); }) as any;
Deno.env.set("ALLOWED_ORIGINS", "https://hgmhendrikx.github.io, https://x.onrender.com/");
Deno.env.set("ELEVENLABS_API_KEY", "k"); Deno.env.set("ELEVENLABS_AGENT_ID", "agent_1");
await import("../../supabase/functions/elevenlabs-token/index.ts");
const get = (origin: string | null, q = "") => handler(new Request("http://f/" + q, { headers: origin ? { origin } : {} }));
const a = (c: boolean, m: string) => { if (!c) throw new Error("FAIL " + m); console.log("ok", m); };
let r = await get("https://evil.com"); a(r.status === 403, "vreemde origin -> 403");
r = await get(null); a(r.status === 403, "geen origin -> 403");
r = await get("https://x.onrender.com"); a(r.status === 200 && (await r.json()).token === "tok123", "toegestane origin (trailing slash in config) -> token");
a(r.headers.get("access-control-allow-origin") === "https://x.onrender.com", "CORS header");
a(seen === "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_1 key=k", "juiste ElevenLabs-call");
Deno.env.set("ACCESS_CODE", "1234");
r = await get("https://hgmhendrikx.github.io"); a(r.status === 401, "code vereist -> 401");
r = await get("https://hgmhendrikx.github.io", "?code=1234"); a(r.status === 200, "juiste code -> 200");
r = await handler(new Request("http://f/", { method: "OPTIONS", headers: { origin: "https://hgmhendrikx.github.io" } })); a(r.status === 204, "preflight");
