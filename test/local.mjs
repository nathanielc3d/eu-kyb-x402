import w from '../src/worker.js';
const base = 'https://kyb.example';
for (const p of ['/', '/.well-known/x402', '/openapi.json', '/llms.txt', '/v1/eu/vat?vat=FR39356000000', '/v1/eu/vat', '/v1/agent-jobs']) {
  const r = await w.fetch(new Request(base + p), {}, { waitUntil() {} }); const t = await r.text();
  console.log('==', p, r.status, r.headers.get('content-type'), t.length);
  const pr = r.headers.get('PAYMENT-REQUIRED');
  if (pr) console.log('  v2:', JSON.stringify(JSON.parse(Buffer.from(pr, 'base64').toString())).slice(0, 300));
}
// invalid input with payment header -> 400, never reaches facilitator
const r = await w.fetch(new Request(base + '/v1/eu/vat?vat=XX1', { headers: { 'PAYMENT-SIGNATURE': 'e30=' } }), {}, { waitUntil() {} });
console.log('== bad input + payment', r.status, await r.text());
