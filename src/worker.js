// Money Machine: "EU KYB & agent-jobs" pay-per-call API for AI agents (x402, USDC on Base, Avalanche C-Chain, Polygon, Celo).
// Runs unchanged on Cloudflare Workers / Deno Deploy / any WinterCG runtime. No dependencies.
// Payments are verified+settled by a public facilitator (no API key, no account; facilitator pays gas):
// PayAI for Base, Ultravioleta DAO (0% fee) for Avalanche C-Chain, Polygon and Celo. Funds go straight to PAY_TO. Built and operated by an AI agent (disclosed in every response).

import { checkIban } from "./iban.js";
import { verdict } from "./counterparty.js";
import { laxOffer } from "./offer.js";

const PAY_TO = "0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FACILITATOR = "https://facilitator.payai.network";
const FACILITATOR_UV = "https://facilitator.ultravioletadao.xyz";
// Accepted payment networks (x402 "exact", EIP-3009 USDC). Base stays FIRST: clients that pick the
// first option behave exactly as before. Same receive address on every EVM chain.
// EIP-712 domains read on-chain (name()/version()) on 2026-10-24; facilitator support read from /supported.
export const NETWORKS = [
  { key: "base", label: "Base", v1: "base", v2: "eip155:8453", asset: USDC_BASE, extra: { name: "USD Coin", version: "2" }, facilitator: FACILITATOR },
  { key: "avalanche", label: "Avalanche C-Chain", v1: "avalanche", v2: "eip155:43114", asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", extra: { name: "USD Coin", version: "2" }, facilitator: FACILITATOR_UV },
  { key: "polygon", label: "Polygon PoS", v1: "polygon", v2: "eip155:137", asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", extra: { name: "USD Coin", version: "2" }, facilitator: FACILITATOR_UV },
  { key: "celo", label: "Celo", v1: "celo", v2: "eip155:42220", asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", extra: { name: "USDC", version: "2" }, facilitator: FACILITATOR_UV },
];
const netByV2 = (n) => NETWORKS.find((x) => x.v2 === n);
const netByV1 = (n) => NETWORKS.find((x) => x.v1 === n || x.v2 === n);
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
  "/v1/iban": {
    price: "3000", name: "iban_check", tags: ["iban", "sepa", "bank", "payments", "kyb", "invoice"],
    desc: "Validate an IBAN offline (ISO 13616 mod 97, registry length per country): validity, country, SEPA and EU membership, national bank code, formatted IBAN and plain reasons when it fails. Params: ?iban=DE89370400440532013000",
    params: { iban: { type: "string", description: "IBAN, spaces allowed, e.g. DE89 3704 0044 0532 0130 00", example: "DE89370400440532013000", required: true } },
    example: { iban: "DE89370400440532013000", valid: true, country: "DE", check_digits: "89", bban: "370400440532013000", length: 22, expected_length: 22, sepa: true, eu: true, bank_code: "37040044", errors: [], formatted: "DE89 3704 0044 0532 0130 00" },
    handler: ibanRoute },
  "/v1/eu/counterparty": {
    price: "10000", name: "eu_counterparty_check", tags: ["kyb", "vat", "iban", "supplier", "invoice-fraud", "compliance"],
    desc: "Supplier or customer check before you pay or invoice: live EU VIES VAT validation, IBAN validation, IBAN country vs VAT country, and claimed name vs registered name, folded into one verdict (pass, review, fail) with plain reasons. Params: ?vat=FR39356000000&iban=FR76...&name=La Poste",
    params: { vat: { type: "string", description: "EU VAT number with country prefix", example: "FR39356000000", required: true }, iban: { type: "string", description: "optional IBAN the counterparty asks you to pay", example: "FR7630006000011234567890189" }, name: { type: "string", description: "optional name the counterparty claims", example: "La Poste" } },
    example: { vat: { vat: "FR39356000000", country: "FR", valid: true, name: "SA LA POSTE" }, iban: { valid: true, country: "FR" }, verdict: "pass", reasons: ["VAT FR39356000000 is valid in VIES"], name_match: 1 },
    handler: counterpartyRoute },
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

// x402 v2 PaymentRequirements (one per accepted network)
function reqV2(path, net = NETWORKS[0]) {
  return { scheme: "exact", network: net.v2, amount: ROUTES[path].price, asset: net.asset, payTo: PAY_TO, maxTimeoutSeconds: 120, extra: { ...net.extra } };
}
// x402 v1 PaymentRequirements (legacy clients)
function reqV1(url, path, net = NETWORKS[0]) {
  const r = ROUTES[path];
  return {
    scheme: "exact", network: net.v1, maxAmountRequired: r.price,
    resource: url.origin + path, description: r.desc, mimeType: "application/json",
    payTo: PAY_TO, maxTimeoutSeconds: 120, asset: net.asset,
    outputSchema: { input: { type: "http", method: "GET", discoverable: true, queryParams: Object.fromEntries(Object.entries(r.params).map(([k, p]) => [k, { type: p.type, description: p.description, required: !!p.required }])) }, output: { type: "json", example: r.example } },
    extra: { ...net.extra },
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
// ---- Base Builder Code (x402 "builder-code" extension, ERC-8021 Schema 2) ----
// Config value BUILDER_CODE (wrangler var, e.g. "bc_xxxxxxxx" from base.dev). Empty = extension not advertised,
// behaviour identical to before. When set, the 402 declares { a: code } so clients echo it and a
// builder-code-aware facilitator appends the ERC-8021 suffix to the settlement calldata.
// Spec: https://github.com/x402-foundation/x402/blob/main/specs/extensions/builder_code.md
const BC_PATTERN = /^[a-z0-9_]{1,32}$/;
const BC_MAX_ECHO_S = 10; // MAX_CLIENT_SERVICE_CODES + MAX_SERVER_SERVICE_CODES
let BUILDER_CODE = "";
export function setBuilderCode(code) { const c = String(code || "").trim(); BUILDER_CODE = BC_PATTERN.test(c) ? c : ""; return BUILDER_CODE; }
const BC_CODE_SCHEMA = { type: "string", pattern: "^[a-z0-9_]{1,32}$" };
export function builderCodeExtension() {
  if (!BUILDER_CODE) return null;
  return { info: { a: BUILDER_CODE }, schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
    properties: { a: { ...BC_CODE_SCHEMA, description: "App builder code" }, w: { ...BC_CODE_SCHEMA, description: "Wallet builder code" },
      s: { type: "array", items: BC_CODE_SCHEMA, description: "Service builder codes" } }, additionalProperties: false } };
}
// Server-side echo validation (spec: resource server MUST reject extension_echo_mismatch before verify/settle).
export function builderCodeEchoError(payload) {
  const raw = payload && payload.extensions && payload.extensions["builder-code"];
  if (!raw) return null;
  const e = raw.info && typeof raw.info === "object" ? raw.info : raw; // @x402 clients echo { info, schema }
  if (e.a !== undefined && e.a !== BUILDER_CODE) return "extension_echo_mismatch: builder-code a";
  const s = e.s === undefined ? [] : Array.isArray(e.s) ? e.s : [e.s];
  if (s.length > BC_MAX_ECHO_S || s.some(x => !BC_PATTERN.test(String(x)))) return "extension_echo_mismatch: builder-code s";
  return null;
}
function paymentRequiredV2(url, path, error) {
  const extensions = { bazaar: bazaar(path) };
  const bc = builderCodeExtension(); if (bc) extensions["builder-code"] = bc;
  return { x402Version: 2, error, resource: resourceInfo(url, path), accepts: NETWORKS.map((n) => reqV2(path, n)), extensions };
}
// 402: v2 object in PAYMENT-REQUIRED header (canonical), v1 object in body (legacy clients/scanners)
function respond402(url, path, error, extraHeaders = {}) {
  return json({ x402Version: 1, error, accepts: NETWORKS.map((n) => reqV1(url, path, n)) }, 402, { "PAYMENT-REQUIRED": b64e(paymentRequiredV2(url, path, error)), ...extraHeaders });
}

async function facilitator(op, version, paymentPayload, paymentRequirements, base = FACILITATOR) {
  try {
    const res = await fetch(`${base}/${op}`, { method: "POST", headers: { "content-type": "application/json", "user-agent": UA },
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
    setBuilderCode(env && env.BUILDER_CODE);
    setRegistrations(env && env.AGENT_REGISTRATIONS);
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
    if (path === "/.well-known/agent-registration.json" || path === "/agent-registration.json") return json(agentRegistration(url), 200, { "cache-control": "public, max-age=300" });
    if (path === "/openapi.json" || path === "/.well-known/openapi.json") return json(openapi(url));
    if (path === "/llms.txt") return text(llmsTxt(url));
    if (path === "/lax-offer.json") return json(laxOffer(ROUTES, url.origin));
    if (path === "/robots.txt") return text("User-agent: *\nAllow: /\n");
    if (path === "/health") return json({ ok: true });
    if (path === "/v1/sample/fr/company") {
      try { return json({ note: "free sample (live query for SIREN 356000000)", ...(await frCompany(new URL(url.origin + "/x?siren=356000000"))) }); }
      catch (e) { return json({ error: "upstream_unavailable", detail: String(e).slice(0, 160), note: "French registry API (recherche-entreprises.api.gouv.fr) is not responding; paid calls are never settled when upstream fails." }, 503, { "retry-after": "300" }); }
    }
    const route = ROUTES[path];
    if (!route) return json({ error: "not_found", catalog: url.origin + "/" }, 404);

    const h2 = request.headers.get("PAYMENT-SIGNATURE"), h1 = request.headers.get("X-PAYMENT");
    // Input is checked before any payment step: a bad request is answered 400 and never charged.
    // A bare unpaid call (no query) gets the 402 terms, so x402 scanners and buyers can read the price.
    const bad = validate(path, url);
    if (bad && (h2 || h1 || url.search)) return json({ error: "bad_request", detail: bad, charged: false }, 400);
    if (!h2 && !h1) return respond402(url, path, "PAYMENT-SIGNATURE header is required (x402 v2; X-PAYMENT accepted for v1)");

    let payload;
    try { payload = b64d(h2 || h1); } catch { return json({ x402Version: 2, error: "invalid_payload: payment header is not base64 JSON", charged: false }, 400); }
    const version = payload.x402Version === 2 ? 2 : 1;
    let req, net;
    if (version === 2) {
      const a = payload.accepted || {};
      net = netByV2(a.network);
      if (!net) return respond402(url, path, "unsupported network (accepted: " + NETWORKS.map((n) => n.v2).join(", ") + ")");
      req = reqV2(path, net);
      if (a.scheme !== "exact" || !same(a.asset, net.asset) || !same(a.payTo, PAY_TO) || String(a.amount) !== req.amount)
        return respond402(url, path, `payment does not match requirements (expected exact / ${net.v2} / USDC ${net.asset} / payTo / amount)`);
      const bcErr = builderCodeEchoError(payload);
      if (bcErr) return respond402(url, path, bcErr);
    } else {
      net = netByV1(payload.network);
      if (payload.scheme !== "exact" || !net) return respond402(url, path, "unsupported scheme/network (expected exact on " + NETWORKS.map((n) => n.v1).join(", ") + ")");
      req = reqV1(url, path, net);
    }

    const v = await facilitator("verify", version, payload, req, net.facilitator);
    if (!v.isValid) return respond402(url, path, v.invalidReason || v.invalidMessage || v.error || "payment invalid");

    let body;
    try { body = await route.handler(url); } catch (e) { return json({ error: "upstream_failed", detail: String(e).slice(0, 200), charged: false }, 502); }
    const s = await facilitator("settle", version, payload, req, net.facilitator);
    if (!s.success) {
      const fail = { success: false, errorReason: s.errorReason || s.error || "settlement failed", transaction: s.transaction || "", network: version === 2 ? net.v2 : net.v1, payer: s.payer || v.payer };
      return respond402(url, path, fail.errorReason, { "PAYMENT-RESPONSE": b64e(fail) });
    }
    const settle = { success: true, transaction: s.transaction, network: s.network || (version === 2 ? net.v2 : net.v1), payer: s.payer || v.payer };
    const hdr = { "PAYMENT-RESPONSE": b64e(settle), "X-PAYMENT-RESPONSE": b64e(settle) };
    if (s.extensionResponses || s.extensions) hdr["EXTENSION-RESPONSES"] = b64e(s.extensionResponses || s.extensions);
    return json({ ...body, _meta: { operator: "Money Machine (autonomous AI agent)", paid_usdc: Number(req.amount || req.maxAmountRequired) / 1e6, network: settle.network, tx: s.transaction } }, 200, hdr);
  }
}

// ---- ERC-8004 agent registration file (https://eips.ethereum.org/EIPS/eip-8004#registration-v1) ----
// Served at /.well-known/agent-registration.json and used as the agentURI of the on-chain identity.
// AGENT_REGISTRATIONS (wrangler var, JSON array of { agentId, agentRegistry }) is filled in once an
// identity is minted; until then "registrations" is honestly empty.
export const ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"; // same CREATE2 address on GOAT (2345), Base, Avalanche...
let REGISTRATIONS = [];
export function setRegistrations(raw) {
  try { const a = typeof raw === "string" ? JSON.parse(raw || "[]") : (raw || []); REGISTRATIONS = Array.isArray(a) ? a.filter((r) => r && /^\d+$/.test(String(r.agentId)) && /^eip155:\d+:0x[0-9a-fA-F]{40}$/.test(r.agentRegistry)).map((r) => ({ agentId: Number(r.agentId), agentRegistry: r.agentRegistry })) : []; }
  catch { REGISTRATIONS = []; }
  return REGISTRATIONS;
}
export function agentRegistration(url) {
  const o = url.origin;
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Money Machine EU KYB",
    description: "Pay-per-call EU counterparty checks for AI agents: supplier verdict (VIES VAT + IBAN + name), EU VAT validation, IBAN validation, French company KYB card, and a feed of agent-eligible paid tasks. Paid per request over x402 in USDC on Base, Avalanche C-Chain, Polygon or Celo; no account, no API key. Built and operated by an autonomous AI agent (\"Money Machine\", filmed challenge); a human operator is reachable by email. Prices: " + Object.entries(ROUTES).map(([p, r]) => `${p} ${Number(r.price) / 1e6} USDC`).join(", ") + ".",
    image: "https://github.com/nathanielc3d.png",
    services: [
      { name: "web", endpoint: o + "/" },
      { name: "x402", endpoint: o + "/.well-known/x402", version: "2" },
      { name: "OpenAPI", endpoint: o + "/openapi.json", version: "3.1.0" },
      { name: "llms.txt", endpoint: o + "/llms.txt" },
      { name: "source", endpoint: "https://github.com/nathanielc3d/eu-kyb-x402" },
      { name: "email", endpoint: "nathanielcloud3@gmail.com" },
      ...NETWORKS.map((n) => ({ name: "agentWallet", endpoint: `${n.v2}:${PAY_TO}` })),
    ],
    x402Support: true,
    active: true,
    registrations: REGISTRATIONS,
    supportedTrust: ["reputation"],
    operator: { kind: "autonomous AI agent", human_contact: "nathanielcloud3@gmail.com", disclosure: "Every response of this API is produced by software operated by an AI agent. Data comes from official public sources; no warranty, not legal advice." },
  };
}

function catalog(url) {
  return { name: "Money Machine - EU KYB & agent-jobs API", operator: "Built and operated by an autonomous AI agent ('Money Machine', filmed challenge). Data from official open sources; no warranty.",
    payment: { protocol: "x402 (v2 + v1 compatible)", scheme: "exact", network: NET_V2 + " (Base mainnet)", asset: "USDC " + USDC_BASE, payTo: PAY_TO, facilitator: FACILITATOR,
      networks: NETWORKS.map((n) => ({ network: n.v2, v1: n.v1, name: n.label, asset: "USDC " + n.asset, facilitator: n.facilitator })),
      howto: "Call a paid endpoint -> HTTP 402 with PAYMENT-REQUIRED header (base64 v2 PaymentRequired; v1 body also provided) -> retry with PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1). Invalid input is rejected with 400 before any charge." },
    endpoints: Object.entries(ROUTES).map(([p, r]) => ({ method: "GET", url: url.origin + p, price_usdc: Number(r.price) / 1e6, params: r.params, description: r.desc })),
    free: ["/v1/sample/fr/company", "/openapi.json", "/llms.txt", "/.well-known/x402", "/.well-known/agent-registration.json", "/lax-offer.json", "/health"],
    sources: ["EU VIES (ec.europa.eu)", "recherche-entreprises.api.gouv.fr (Licence Ouverte 2.0)", "api.taskmarket.dev", "superteam.fun agent API"], contact: "nathanielcloud3@gmail.com" };
}

function wellKnown(url) {
  return { version: 1, resources: Object.keys(ROUTES).map(p => url.origin + p), openapi: url.origin + "/openapi.json",
    instructions: "Pay-per-call EU counterparty verdict, EU VAT (VIES) and IBAN validation, French company KYB and agent-jobs feed. x402 exact, USDC on Base (eip155:8453, facilitator PayAI), Avalanche C-Chain (eip155:43114), Polygon (eip155:137) or Celo (eip155:42220) (facilitator Ultravioleta DAO). Operated by an autonomous AI agent.",
    x402Version: 2, items: Object.keys(ROUTES).map(p => paymentRequiredV2(url, p, "discovery")) };
}

function openapi(url) {
  const paths = {};
  for (const [p, r] of Object.entries(ROUTES)) {
    paths[p] = { get: {
      operationId: r.name, summary: r.desc.split(". ")[0], description: r.desc, tags: ["paid"],
      "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: (Number(r.price) / 1e6).toFixed(6) }, protocols: [{ x402: {} }],
        network: NET_V2, asset: USDC_BASE, payTo: PAY_TO, facilitator: FACILITATOR,
        "x-networks": NETWORKS.map((n) => ({ network: n.v2, asset: n.asset, facilitator: n.facilitator })) },
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
  paths["/.well-known/agent-registration.json"] = free("ERC-8004 agent registration file");
  paths["/"] = free("Service catalog");
  return {
    openapi: "3.1.0",
    info: { title: "Money Machine - EU KYB & agent-jobs API (x402)", version: "1.3.0",
      description: "Pay-per-call API for AI agents: EU counterparty verdict (VAT + IBAN + name), EU VAT validation via VIES, IBAN validation, French company KYB from official open data, and a feed of agent-eligible paid tasks. No account, no API key: pay per request in USDC via x402 on Base, Avalanche C-Chain, Polygon or Celo. Built and operated by an autonomous AI agent.",
      "x-guidance": "GET /v1/eu/counterparty?vat=BE0403170701&iban=BE68539007547034&name=Electrabel for a pass, review or fail verdict before paying a supplier (0.01 USD). GET /v1/iban?iban=DE89370400440532013000 to validate an IBAN (0.003 USD). GET /v1/eu/vat?vat=FR39356000000 to validate an EU VAT number (0.003 USD). GET /v1/fr/company?siren=356000000 or ?q=name for a French company card with VAT check (0.005 USD). GET /v1/agent-jobs for open agent-eligible bounties (0.003 USD). Unpaid calls return HTTP 402 with x402 requirements; invalid input returns 400 and is not charged.",
      contact: { name: "Money Machine (AI agent)", email: "nathanielcloud3@gmail.com", url: url.origin + "/" }, "x-operator": "autonomous AI agent" },
    servers: [{ url: url.origin }],
    paths,
  };
}

function llmsTxt(url) {
  const o = url.origin;
  return `# Money Machine - EU KYB & agent-jobs API (x402)

> Pay-per-call JSON API for AI agents. No account or API key: pay each request in USDC with the x402 protocol (exact scheme) on Base (eip155:8453, facilitator ${FACILITATOR}), Avalanche C-Chain (eip155:43114), Polygon (eip155:137) or Celo (eip155:42220) (facilitator ${FACILITATOR_UV}, 0% fee). Same price on every network. Built and operated by an autonomous AI agent ("Money Machine"). Data comes from official public sources (EU VIES, INSEE/RNE open data).

## Paid endpoints (GET)
${Object.entries(ROUTES).map(([p, r]) => `- [${o}${p}](${o}${p}): ${Number(r.price) / 1e6} USDC. ${r.desc}`).join("\n")}

## How to pay
1. Call the endpoint. You get HTTP 402 with a PAYMENT-REQUIRED header (base64 x402 v2 PaymentRequired). A v1 body ({x402Version:1, accepts}) is also returned. \`accepts\` lists one option per network, Base first.
2. Pick the network where you hold USDC and sign an EIP-3009 USDC transferWithAuthorization for the amount to ${PAY_TO} (any x402 client: @x402/fetch, x402-axios, x402 python).

Networks and USDC contracts:
${NETWORKS.map((n) => `- ${n.label}: ${n.v2} (v1 "${n.v1}"), USDC ${n.asset}, facilitator ${n.facilitator}`).join("\n")}
3. Retry with PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1). Response carries PAYMENT-RESPONSE with the settlement tx.
Invalid input returns 400 before any charge. Upstream failure returns 502 and the payment is not settled.

## Free
- [Catalog](${o}/): JSON catalog
- [OpenAPI](${o}/openapi.json)
- [x402 manifest](${o}/.well-known/x402)
- [Sample](${o}/v1/sample/fr/company): free example company card
- [LAX offer](${o}/lax-offer.json): the offer listed on the Kognai LAX registry
- [ERC-8004 registration file](${o}/.well-known/agent-registration.json): agent identity card (agentURI for the ERC-8004 Identity Registry)

## Refuses
- Lookups of private persons, bulk scraping, non EU VAT numbers, and anything that is not a counterparty check. Bad input is refused with 400 and never charged.
`;
}

function landingHtml(url) {
  const rows = Object.entries(ROUTES).map(([p, r]) => `<tr><td><code>GET ${p}</code></td><td>${Number(r.price) / 1e6} USDC</td><td>${r.desc}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Money Machine - EU KYB x402 API</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}td{border-top:1px solid #ddd;padding:.5rem;vertical-align:top}code{background:#f3f3f3;padding:0 .2rem}</style></head><body>
<h1>Money Machine - EU KYB &amp; agent-jobs API</h1><p>Pay-per-call API for AI agents over <a href="https://x402.org">x402</a>: USDC on Base, Avalanche C-Chain, Polygon or Celo, no account, no API key. <b>Built and operated by an autonomous AI agent.</b></p>
<table>${rows}</table><p>Machine-readable: <a href="/openapi.json">/openapi.json</a> · <a href="/llms.txt">/llms.txt</a> · <a href="/.well-known/x402">/.well-known/x402</a> · <a href="/.well-known/agent-registration.json">ERC-8004 card</a> · free <a href="/v1/sample/fr/company">sample</a></p>
<p>payTo <code>${PAY_TO}</code> · facilitators PayAI (Base) and Ultravioleta DAO (Avalanche, Polygon, Celo) · data: EU VIES, recherche-entreprises.api.gouv.fr (Licence Ouverte 2.0)</p></body></html>`;
}

function validate(path, url) {
  if (path === "/v1/eu/vat") {
    const v = (url.searchParams.get("vat") || "").toUpperCase().replace(/[\s.\-]/g, "");
    if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v) || !EU.includes(v.slice(0, 2))) return "vat must be an EU VAT number with country prefix, e.g. FR39356000000, DE811569869";
  }
  if (path === "/v1/iban") {
    const i = (url.searchParams.get("iban") || "").replace(/[\s\-.]/g, "");
    if (!/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{8,32}$/.test(i)) return "iban must look like an IBAN: 2 letters, 2 digits, then 8 to 32 letters or digits";
  }
  if (path === "/v1/eu/counterparty") {
    const v = (url.searchParams.get("vat") || "").toUpperCase().replace(/[\s.\-]/g, "");
    if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v) || !EU.includes(v.slice(0, 2))) return "vat must be an EU VAT number with country prefix, e.g. FR39356000000";
    const i = url.searchParams.get("iban");
    if (i && !/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{8,32}$/.test(i.replace(/[\s\-.]/g, ""))) return "iban, when given, must look like an IBAN";
    const n = url.searchParams.get("name");
    if (n && (n.length < 2 || n.length > 200)) return "name, when given, must be 2 to 200 characters";
  }
  if (path === "/v1/fr/company") {
    const siren = url.searchParams.get("siren"), q = url.searchParams.get("q");
    if (siren && !/^\d{9}$/.test(siren.replace(/\s/g, ""))) return "siren must be 9 digits";
    if (!siren && (!q || q.length < 3)) return "give ?siren=9digits or ?q=name (>=3 chars)";
  }
  return null;
}

const VIES_DOWN = new Set(["MS_UNAVAILABLE", "TIMEOUT", "SERVICE_UNAVAILABLE", "MS_MAX_CONCURRENT_REQ", "GLOBAL_MAX_CONCURRENT_REQ", "INVALID_REQUESTER_INFO"]);

async function viesOnce(cc, num) {
  const r = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${encodeURIComponent(num)}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("VIES HTTP " + r.status);
  return r.json();
}

// One retry on the transient VIES errors (member state busy); never reports "invalid" when VIES is down.
async function vies(cc, num) {
  let d = await viesOnce(cc, num);
  if (VIES_DOWN.has(d.userError)) { await new Promise((ok) => setTimeout(ok, 1500)); d = await viesOnce(cc, num); }
  if (VIES_DOWN.has(d.userError)) throw new Error("VIES member state service unavailable: " + d.userError);
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
  return { query: q, count: results.length, results, source: "recherche-entreprises.api.gouv.fr (INSEE Sirene, RNE), Licence Ouverte 2.0" };
}

async function ibanRoute(url) {
  return { ...checkIban(url.searchParams.get("iban")), checked_at: new Date().toISOString(), source: "ISO 13616 mod 97 and the SWIFT IBAN registry lengths (offline)" };
}

async function counterpartyRoute(url) {
  const vatNum = url.searchParams.get("vat").toUpperCase().replace(/[\s.\-]/g, "");
  const vat = { vat: vatNum, country: vatNum.slice(0, 2), ...(await vies(vatNum.slice(0, 2), vatNum.slice(2))) };
  const ibanRaw = url.searchParams.get("iban");
  const iban = ibanRaw ? checkIban(ibanRaw) : null;
  const name = url.searchParams.get("name") || null;
  return { vat, iban, claimed_name: name, ...verdict({ vat, iban, name }), checked_at: new Date().toISOString(), note: "Decision support from official public data, not legal advice. A pass does not prove who you are talking to." };
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
export { agentJobs, euVat, frCompany, ibanRoute, counterpartyRoute, validate, handle, ROUTES };
