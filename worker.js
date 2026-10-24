// Money Machine — "EU KYB & agent-jobs" pay-per-call API for AI agents (x402, USDC on Base).
// Runs unchanged on Cloudflare Workers / Deno Deploy / any WinterCG runtime. No dependencies.
// Payments are verified+settled by the PayAI facilitator (no API key; facilitator pays gas),
// funds go straight to PAY_TO. Built and operated by an AI agent (disclosed in every response).

const PAY_TO = "0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FACILITATOR = "https://facilitator.payai.network";
const UA = "MoneyMachine-x402/1.1 (AI-operated; contact nathanielcloud3@gmail.com)";

const EU = ["AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"];

// ---- priced routes (atomic USDC, 6 decimals) ----
const ROUTES = {
  "/v1/eu/vat": {
    price: "3000", name: "eu_vat_check", tags: ["vat", "vies", "eu", "kyb", "compliance", "invoice"],
    desc: "Validate an EU VAT number live against the official EU VIES service (27 member states + XI). Returns validity, registered name and address. Params: ?vat=FR39356000000",
    params: { vat: { type: "string", description: "EU VAT number with 2-letter country prefix, e.g. FR39356000000, DE811569869", example: "FR39356000000", required: true } },
    example: { vat: "FR39356000000", country: "FR", valid: true, status: "VALID", name: "SA LA POSTE-DIRECTION GENERALE DE LA PO", address: "9 RUE DU COLONEL PIERRE AVIA 92130 ISSY LES MOULINEAUX", checked_at: "2026-10-24T07:03:44.951Z", source: "EU VIES" },
    handler: euVat },
  "/v1/fr/company": {
    price: "5000", name: "fr_company_kyb", tags: ["france", "company", "siren", "kyb", "sirene", "business-registry"],
    desc: "French company KYB card from official open data (INSEE/RNE via recherche-entreprises.api.gouv.fr) + live VIES VAT check: status, legal form, NAF, HQ address, headcount band, directors, last revenue/net income, labels (RGE, Qualiopi, ESS...). Params: ?siren=356000000 or ?q=name",
    params: { siren: { type: "string", description: "9-digit SIREN number (give siren OR q)", example: "356000000" }, q: { type: "string", description: "Company name search, >= 3 chars (give siren OR q)", example: "la poste" } },
    example: { query: "356000000", count: 1, results: [{ siren: "356000000", name: "LA POSTE", status: "active", legal_form_code: "5510", naf: "53.10Z", hq: { city: "PARIS" }, vat_number: "FR39356000000", vat_check: { valid: true } }], source: "recherche-entreprises.api.gouv.fr" },
    handler: frCompany },
  "/v1/agent-jobs": {
    price: "3000", name: "agent_jobs_feed", tags: ["agents", "jobs", "bounties", "tasks", "earn", "crypto"],
    desc: "Live feed of funded, agent-eligible paid tasks across agent job boards (Taskmarket on Base, Superteam Earn agent listings), normalized: reward, token, deadline, submissions, link. Refreshed on every call.",
    params: {},
    example: { generated_at: "2026-10-24T07:00:00.000Z", count: 1, jobs: [{ venue: "taskmarket", ref: "TSK-1XX8G7AY", title: "Generative Art Card", reward: 10, token: "USDC (Base)", deadline: "2026-10-24T20:37:37.966Z", url: "https://taskmarket.dev/tasks/0x..." }] },
    handler: agentJobs },
};

const SERVICE = "Money Machine EU KYB";
const NET_V1 = "base", NET_V2 = "eip155:8453";
const EXPOSE = "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, EXTENSION-RESPONSES";
const json = (o, status = 200, h = {}) => new Response(status === 204 ? null : JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-expose-headers": EXPOSE, ...h } });
const text = (t, type = "text/plain") => new Response(t, { headers: { "content-type": type + "; charset=utf-8", "access-control-allow-origin": "*" } });
// UTF-8 safe base64 (spec: base64-encoded JSON)
const b64e = (o) => { const b = new TextEncoder().encode(JSON.stringify(o)); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const b64d = (s) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.trim()), c => c.charCodeAt(0))));

const EXTRA = { name: "USD Coin", version: "2" }; // EIP-712 domain of native USDC on Base

// x402 v2 PaymentRequirements
function reqV2(path) {
  return { scheme: "exact", network: NET_V2, amount: ROUTES[path].price, asset: USDC_BASE, payTo: PAY_TO, maxTimeoutSeconds: 120, extra: EXTRA };
}
// x402 v1 PaymentRequirements (legacy clients)
function reqV1(url, path) {
  const r = ROUTES[path];
  return {
    scheme: "exact", network: NET_V1, maxAmountRequired: r.price,
    resource: url.origin + path, description: r.desc, mimeType: "application/json",
    payTo: PAY_TO, maxTimeoutSeconds: 120, asset: USDC_BASE,
    outputSchema: { input: { type: "http", method: "GET", discoverable: true, queryParams: Object.fromEntries(Object.entries(r.params).map(([k, p]) => [k, { type: p.type, description: p.description, required: !!p.required }])) }, output: { type: "json", example: r.example } },
    extra: EXTRA,
  };
}
function resourceInfo(url, path) {
  const r = ROUTES[path];
  return { url: url.origin + path, description: r.desc, mimeType: "application/json", serviceName: SERVICE, tags: r.tags };
}
// bazaar discovery extension (specs/extensions/bazaar.md)
function bazaar(path) {
  const r = ROUTES[path];
  const qp = path === "/v1/fr/company" ? { siren: r.params.siren.example } : Object.fromEntries(Object.entries(r.params).filter(([, p]) => p.required).map(([k, p]) => [k, p.example]));
  return {
    info: { input: { type: "http", method: "GET", ...(Object.keys(qp).length ? { queryParams: qp } : {}) }, output: { type: "json", example: r.example } },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
      properties: {
        input: { type: "object", properties: {
          type: { type: "string", const: "http" }, method: { type: "string", enum: ["GET", "HEAD", "DELETE"] },
          queryParams: { type: "object", properties: Object.fromEntries(Object.entries(r.params).map(([k, p]) => [k, { type: p.type, description: p.description }])), required: Object.entries(r.params).filter(([, p]) => p.required).map(([k]) => k) },
          headers: { type: "object", additionalProperties: { type: "string" } } },
          required: ["type", "method"], additionalProperties: false },
        output: { type: "object", properties: { type: { type: "string" }, example: { type: "object" } }, required: ["type"] },
      },
      required: ["input"],
    },
  };
}
function paymentRequiredV2(url, path, error) {
  return { x402Version: 2, error, resource: resourceInfo(url, path), accepts: [reqV2(path)], extensions: { bazaar: bazaar(path) } };
}
// 402: v2 object in PAYMENT-REQUIRED header (canonical), v1 object in body (legacy clients/scanners)
function respond402(url, path, error, extraHeaders = {}) {
  return json({ x402Version: 1, error, accepts: [reqV1(url, path)] }, 402, { "PAYMENT-REQUIRED": b64e(paymentRequiredV2(url, path, error)), ...extraHeaders });
}

async function facilitator(op, version, paymentPayload, paymentRequirements) {
  try {
    const res = await fetch(`${FACILITATOR}/${op}`, { method: "POST", headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ x402Version: version, paymentPayload, paymentRequirements }), signal: AbortSignal.timeout(30000) });
    const t = await res.text();
    let d; try { d = JSON.parse(t); } catch { d = {}; }
    if (!res.ok && d.isValid === undefined && d.success === undefined) d.error = `facilitator ${op} HTTP ${res.status}: ${t.slice(0, 200)}`;
    return d;
  } catch (e) { return { error: `facilitator ${op} unreachable: ${String(e).slice(0, 120)}` }; }
}

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// Lightweight usage counters in KV (daily keys, best effort, never blocks a response).
async function bump(env, key) {
  try {
    if (!env || !env.STATS) return;
    const k = new Date().toISOString().slice(0, 10) + ":" + key;
    const n = parseInt((await env.STATS.get(k)) || "0", 10) + 1;
    await env.STATS.put(k, String(n), { expirationTtl: 60 * 60 * 24 * 120 });
  } catch (_) {}
}

export default {
  async fetch(request, env, ctx) {
    const res = await handle(request);
    try {
      const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
      if (request.method === "GET" && (ROUTES[path] || path === "/v1/sample/fr/company")) {
        const ev = res.status === 200 ? (path.startsWith("/v1/sample") ? "sample" : "paid") : String(res.status);
        console.log(JSON.stringify({ ev, path, ua: (request.headers.get("user-agent") || "").slice(0, 80) }));
        ctx.waitUntil(bump(env, ev + ":" + path));
      }
    } catch (_) {}
    return res;
  },
};

async function handle(request) {
  {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return json(null, 204, { "access-control-allow-headers": "PAYMENT-SIGNATURE, X-PAYMENT, content-type", "access-control-allow-methods": "GET, HEAD, OPTIONS" });
    if (path === "/" || path === "/v1") {
      if ((request.headers.get("accept") || "").includes("text/html")) return text(landingHtml(url), "text/html");
      return json(catalog(url));
    }
    if (path === "/.well-known/x402") return json(wellKnown(url));
    if (path === "/openapi.json" || path === "/.well-known/openapi.json") return json(openapi(url));
    if (path === "/llms.txt") return text(llmsTxt(url));
    if (path === "/robots.txt") return text("User-agent: *\nAllow: /\n");
    if (path === "/health") return json({ ok: true });
    if (path === "/v1/sample/fr/company") {
      try { return json({ note: "free sample (live query for SIREN 356000000)", ...(await frCompany(new URL(url.origin + "/x?siren=356000000"))) }); }
      catch (e) { return json({ error: "upstream_unavailable", detail: String(e).slice(0, 160), note: "French registry API (recherche-entreprises.api.gouv.fr) is not responding; paid calls are never settled when upstream fails." }, 503, { "retry-after": "300" }); }
    }
    const route = ROUTES[path];
    if (!route) return json({ error: "not_found", catalog: url.origin + "/" }, 404);

    const h2 = request.headers.get("PAYMENT-SIGNATURE"), h1 = request.headers.get("X-PAYMENT");
    if (!h2 && !h1) return respond402(url, path, "PAYMENT-SIGNATURE header is required (x402 v2; X-PAYMENT accepted for v1)");

    // validate input BEFORE verify/settle -> never charged for a bad request
    const bad = validate(path, url);
    if (bad) return json({ error: "bad_request", detail: bad, charged: false }, 400);

    let payload;
    try { payload = b64d(h2 || h1); } catch { return json({ x402Version: 2, error: "invalid_payload: payment header is not base64 JSON", charged: false }, 400); }
    const version = payload.x402Version === 2 ? 2 : 1;
    let req;
    if (version === 2) {
      req = reqV2(path);
      const a = payload.accepted || {};
      if (a.scheme !== "exact" || a.network !== NET_V2 || !same(a.asset, USDC_BASE) || !same(a.payTo, PAY_TO) || String(a.amount) !== req.amount)
        return respond402(url, path, "payment does not match requirements (expected exact / eip155:8453 / USDC / payTo / amount)");
    } else {
      req = reqV1(url, path);
      if (payload.scheme !== "exact" || payload.network !== NET_V1) return respond402(url, path, "unsupported scheme/network (expected exact on base)");
    }

    const v = await facilitator("verify", version, payload, req);
    if (!v.isValid) return respond402(url, path, v.invalidReason || v.invalidMessage || v.error || "payment invalid");

    let body;
    try { body = await route.handler(url); } catch (e) { return json({ error: "upstream_failed", detail: String(e).slice(0, 200), charged: false }, 502); }
    const s = await facilitator("settle", version, payload, req);
    if (!s.success) {
      const fail = { success: false, errorReason: s.errorReason || s.error || "settlement failed", transaction: s.transaction || "", network: version === 2 ? NET_V2 : NET_V1, payer: s.payer || v.payer };
      return respond402(url, path, fail.errorReason, { "PAYMENT-RESPONSE": b64e(fail) });
    }
    const settle = { success: true, transaction: s.transaction, network: s.network || (version === 2 ? NET_V2 : NET_V1), payer: s.payer || v.payer };
    const hdr = { "PAYMENT-RESPONSE": b64e(settle), "X-PAYMENT-RESPONSE": b64e(settle) };
    if (s.extensionResponses || s.extensions) hdr["EXTENSION-RESPONSES"] = b64e(s.extensionResponses || s.extensions);
    return json({ ...body, _meta: { operator: "Money Machine (autonomous AI agent)", paid_usdc: Number(req.amount || req.maxAmountRequired) / 1e6, network: settle.network, tx: s.transaction } }, 200, hdr);
  }
}

function catalog(url) {
  return { name: "Money Machine - EU KYB & agent-jobs API", operator: "Built and operated by an autonomous AI agent ('Money Machine', filmed challenge). Data from official open sources; no warranty.",
    payment: { protocol: "x402 (v2 + v1 compatible)", scheme: "exact", network: NET_V2 + " (Base mainnet)", asset: "USDC " + USDC_BASE, payTo: PAY_TO, facilitator: FACILITATOR,
      howto: "Call a paid endpoint -> HTTP 402 with PAYMENT-REQUIRED header (base64 v2 PaymentRequired; v1 body also provided) -> retry with PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1). Invalid input is rejected with 400 before any charge." },
    endpoints: Object.entries(ROUTES).map(([p, r]) => ({ method: "GET", url: url.origin + p, price_usdc: Number(r.price) / 1e6, params: r.params, description: r.desc })),
    free: ["/v1/sample/fr/company", "/openapi.json", "/llms.txt", "/.well-known/x402", "/health"],
    sources: ["EU VIES (ec.europa.eu)", "recherche-entreprises.api.gouv.fr (Licence Ouverte 2.0)", "api.taskmarket.dev", "superteam.fun agent API"], contact: "nathanielcloud3@gmail.com" };
}

function wellKnown(url) {
  return { version: 1, resources: Object.keys(ROUTES).map(p => url.origin + p), openapi: url.origin + "/openapi.json",
    instructions: "Pay-per-call EU VAT (VIES) validation, French company KYB and agent-jobs feed. x402 exact, USDC on Base (eip155:8453), facilitator PayAI. Operated by an autonomous AI agent.",
    x402Version: 2, items: Object.keys(ROUTES).map(p => paymentRequiredV2(url, p, "discovery")) };
}

function openapi(url) {
  const paths = {};
  for (const [p, r] of Object.entries(ROUTES)) {
    paths[p] = { get: {
      operationId: r.name, summary: r.desc.split(". ")[0], description: r.desc, tags: ["paid"],
      "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: (Number(r.price) / 1e6).toFixed(6) }, protocols: [{ x402: {} }],
        network: NET_V2, asset: USDC_BASE, payTo: PAY_TO, facilitator: FACILITATOR },
      parameters: Object.entries(r.params).map(([k, q]) => ({ name: k, in: "query", required: !!q.required, description: q.description, schema: { type: q.type }, example: q.example })),
      responses: {
        200: { description: "Successful response", content: { "application/json": { schema: { type: "object", additionalProperties: true }, example: r.example } } },
        400: { description: "Invalid input (never charged)" },
        402: { description: "Payment Required (x402: PAYMENT-REQUIRED header, v1 JSON body)" },
      } } };
  }
  const free = (summary) => ({ get: { summary, security: [], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object" } } } } } } });
  paths["/v1/sample/fr/company"] = free("Free sample of the French company KYB card (SIREN 356000000)");
  paths["/health"] = free("Health check");
  paths["/"] = free("Service catalog");
  return {
    openapi: "3.1.0",
    info: { title: "Money Machine - EU KYB & agent-jobs API (x402)", version: "1.1.0",
      description: "Pay-per-call API for AI agents: EU VAT validation via VIES, French company KYB from official open data, and a feed of agent-eligible paid tasks. No account, no API key: pay per request in USDC on Base via x402. Built and operated by an autonomous AI agent.",
      "x-guidance": "GET /v1/eu/vat?vat=FR39356000000 to validate an EU VAT number (0.003 USD). GET /v1/fr/company?siren=356000000 or ?q=name for a French company card with VAT check (0.005 USD). GET /v1/agent-jobs for open agent-eligible bounties (0.003 USD). Unpaid calls return HTTP 402 with x402 requirements; invalid input returns 400 and is not charged.",
      contact: { name: "Money Machine (AI agent)", email: "nathanielcloud3@gmail.com", url: url.origin + "/" }, "x-operator": "autonomous AI agent" },
    servers: [{ url: url.origin }],
    paths,
  };
}

function llmsTxt(url) {
  const o = url.origin;
  return `# Money Machine - EU KYB & agent-jobs API (x402)

> Pay-per-call JSON API for AI agents. No account or API key: pay each request in USDC on Base (eip155:8453) with the x402 protocol (exact scheme, facilitator ${FACILITATOR}). Built and operated by an autonomous AI agent ("Money Machine"). Data comes from official public sources (EU VIES, INSEE/RNE open data).

## Paid endpoints (GET)
${Object.entries(ROUTES).map(([p, r]) => `- [${o}${p}](${o}${p}): ${Number(r.price) / 1e6} USDC. ${r.desc}`).join("\n")}

## How to pay
1. Call the endpoint. You get HTTP 402 with a PAYMENT-REQUIRED header (base64 x402 v2 PaymentRequired). A v1 body ({x402Version:1, accepts}) is also returned.
2. Sign an EIP-3009 USDC transferWithAuthorization for the amount to ${PAY_TO} (any x402 client: @x402/fetch, x402-axios, x402 python).
3. Retry with PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1). Response carries PAYMENT-RESPONSE with the settlement tx.
Invalid input returns 400 before any charge. Upstream failure returns 502 and the payment is not settled.

## Free
- [Catalog](${o}/): JSON catalog
- [OpenAPI](${o}/openapi.json)
- [x402 manifest](${o}/.well-known/x402)
- [Sample](${o}/v1/sample/fr/company): free example company card
`;
}

function landingHtml(url) {
  const rows = Object.entries(ROUTES).map(([p, r]) => `<tr><td><code>GET ${p}</code></td><td>${Number(r.price) / 1e6} USDC</td><td>${r.desc}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Money Machine - EU KYB x402 API</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}td{border-top:1px solid #ddd;padding:.5rem;vertical-align:top}code{background:#f3f3f3;padding:0 .2rem}</style></head><body>
<h1>Money Machine - EU KYB &amp; agent-jobs API</h1><p>Pay-per-call API for AI agents over <a href="https://x402.org">x402</a>: USDC on Base, no account, no API key. <b>Built and operated by an autonomous AI agent.</b></p>
<table>${rows}</table><p>Machine-readable: <a href="/openapi.json">/openapi.json</a> · <a href="/llms.txt">/llms.txt</a> · <a href="/.well-known/x402">/.well-known/x402</a> · free <a href="/v1/sample/fr/company">sample</a></p>
<p>payTo <code>${PAY_TO}</code> · facilitator PayAI · data: EU VIES, recherche-entreprises.api.gouv.fr (Licence Ouverte 2.0)</p></body></html>`;
}

function validate(path, url) {
  if (path === "/v1/eu/vat") {
    const v = (url.searchParams.get("vat") || "").toUpperCase().replace(/[\s.\-]/g, "");
    if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v) || !EU.includes(v.slice(0, 2))) return "vat must be an EU VAT number with country prefix, e.g. FR39356000000, DE811569869";
  }
  if (path === "/v1/fr/company") {
    const siren = url.searchParams.get("siren"), q = url.searchParams.get("q");
    if (siren && !/^\d{9}$/.test(siren.replace(/\s/g, ""))) return "siren must be 9 digits";
    if (!siren && (!q || q.length < 3)) return "give ?siren=9digits or ?q=name (>=3 chars)";
  }
  return null;
}

async function vies(cc, num) {
  const r = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${encodeURIComponent(num)}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("VIES HTTP " + r.status);
  const d = await r.json();
  return { valid: !!d.isValid, status: d.userError, name: d.name && d.name !== "---" ? d.name : null, address: d.address && d.address !== "---" ? d.address : null, checked_at: d.requestDate, source: "EU VIES" };
}

async function euVat(url) {
  const v = url.searchParams.get("vat").toUpperCase().replace(/[\s.\-]/g, "");
  return { vat: v, country: v.slice(0, 2), ...(await vies(v.slice(0, 2), v.slice(2))) };
}

function frVatFromSiren(siren) { const key = (12 + 3 * (Number(siren) % 97)) % 97; return "FR" + String(key).padStart(2, "0") + siren; }

async function frCompany(url) {
  const siren = (url.searchParams.get("siren") || "").replace(/\s/g, "");
  const q = siren || url.searchParams.get("q");
  const r = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=${siren ? 1 : 3}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("recherche-entreprises HTTP " + r.status);
  const d = await r.json();
  const pick = (x) => {
    const s = x.siege || {}, c = x.complements || {};
    const fin = x.finances ? Object.entries(x.finances).sort().pop() : null;
    return {
      siren: x.siren, name: x.nom_complet, status: x.etat_administratif === "A" ? "active" : "ceased", created: x.date_creation, ceased: x.date_fermeture,
      legal_form_code: x.nature_juridique, naf: x.activite_principale, size_category: x.categorie_entreprise, headcount_band: x.tranche_effectif_salarie,
      hq: { siret: s.siret, address: s.adresse, postcode: s.code_postal, city: s.libelle_commune, lat: s.latitude, lon: s.longitude },
      establishments_open: x.nombre_etablissements_ouverts,
      directors: (x.dirigeants || []).slice(0, 12).map(p => p.type_dirigeant === "personne morale" ? { company: p.denomination, siren: p.siren, role: p.qualite } : { name: `${p.prenoms || ""} ${p.nom || ""}`.trim(), role: p.qualite, birth_year: p.annee_de_naissance }),
      finances_latest: fin ? { year: fin[0], revenue_eur: fin[1].ca, net_income_eur: fin[1].resultat_net } : null,
      labels: Object.fromEntries(Object.entries(c).filter(([k, v]) => k.startsWith("est_") && v === true).map(([k]) => [k.slice(4), true])),
      vat_number: (x.tva && x.tva[0]) || frVatFromSiren(x.siren),
    };
  };
  const results = (d.results || []).map(pick);
  if (results[0]) { try { results[0].vat_check = await vies("FR", results[0].vat_number.slice(2)); } catch (e) { results[0].vat_check = { error: String(e) }; } }
  return { query: q, count: results.length, results, source: "recherche-entreprises.api.gouv.fr (INSEE Sirene, RNE) — Licence Ouverte 2.0" };
}

async function agentJobs() {
  const out = [];
  try {
    const r = await fetch("https://api.taskmarket.dev/api/tasks?status=open&limit=50", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    for (const t of d.tasks || []) out.push({ venue: "taskmarket", id: t.id, ref: t.referenceCode, title: t.description.split("\n").find(l => l.trim())?.slice(0, 140), reward: Number(t.reward) / 1e6, token: t.chainId === 8453 ? "USDC (Base)" : "OUSD (Tempo)", mode: t.mode, deadline: t.expiryTime, submissions: t.submissionCount, url: `https://taskmarket.dev/tasks/${t.id}` });
  } catch (e) { out.push({ venue: "taskmarket", error: String(e) }); }
  try {
    const r = await fetch("https://superteam.fun/api/listings?take=100&status=open", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    for (const l of d || []) if (l.agentAccess && l.agentAccess !== "HUMAN_ONLY") out.push({ venue: "superteam", id: l.id, title: l.title, reward: l.rewardAmount, token: l.token, deadline: l.deadline, submissions: l._count?.Submission, agent_access: l.agentAccess, url: `https://superteam.fun/earn/listing/${l.slug}` });
  } catch (e) { out.push({ venue: "superteam", error: String(e) }); }
  out.sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));
  return { generated_at: new Date().toISOString(), count: out.length, jobs: out, note: "Only boards with verifiable funding/escrow are included. Always re-check terms on the venue." };
}
export { agentJobs, euVat, frCompany };
