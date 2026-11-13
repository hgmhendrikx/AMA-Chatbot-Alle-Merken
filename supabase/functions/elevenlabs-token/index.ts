// Supabase Edge Function: elevenlabs-token
// ------------------------------------------------------------------
// Geeft de browser een kortlevend gesprekstoken voor de (private)
// ElevenLabs-agent. Zo staat je ElevenLabs API-sleutel nooit in de
// frontend en kan niemand jouw agent buiten jouw site om gebruiken.
//
// Request:  GET  (vanuit de browser, met Origin-header; ?code=… als ACCESS_CODE gezet is)
// Response: { "token": "..." }
//
// Secrets:
//   ELEVENLABS_API_KEY   – API-sleutel met rechten op ElevenAgents
//   ELEVENLABS_AGENT_ID  – ID van de agent (agent_...)
//   ALLOWED_ORIGINS      – komma-gescheiden, bv. "https://hgmhendrikx.github.io"
//   ACCESS_CODE          – optioneel: zelfde code als voor de chat
// ------------------------------------------------------------------
import { checkAccess, corsHeaders } from "../_shared/retrieval.ts";

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), "GET, OPTIONS");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const denied = checkAccess(req, true);
  if (denied) return reply({ error: denied[1] }, denied[0]);

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  const agentId = Deno.env.get("ELEVENLABS_AGENT_ID");
  if (!apiKey || !agentId) return reply({ error: "Spraak is nog niet geconfigureerd" }, 503);

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
    { headers: { "xi-api-key": apiKey } },
  );
  if (!res.ok) {
    console.error("ElevenLabs token", res.status, await res.text());
    return reply({ error: "Kon geen gesprekstoken ophalen" }, 502);
  }
  const { token } = await res.json();
  return reply({ token });
});
