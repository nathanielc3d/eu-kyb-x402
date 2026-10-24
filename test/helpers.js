import { readFileSync, readdirSync } from "node:fs";
export const root = new URL("../", import.meta.url);
export const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
export const offer = () => readJson("lax-offer.json");
export const examples = () => readdirSync(new URL("examples/", root)).filter((f) => f.endsWith(".json")).map((f) => ({ file: f, ...readJson("examples/" + f) }));
export const readme = () => readFileSync(new URL("README.md", root), "utf8");
export const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
export const unb64 = (s) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

/** Replace global fetch for one test; routes by URL substring. Records calls. */
export function mockFetch(t, routes) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input.url || input);
    calls.push({ url, body: init.body });
    for (const [frag, fn] of Object.entries(routes)) if (url.includes(frag)) {
      const r = await fn(url, init);
      return new Response(JSON.stringify(r.body ?? r), { status: r.status || 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("network disabled in tests: " + url);
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
