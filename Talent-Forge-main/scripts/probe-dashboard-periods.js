// Read-only. For AGENT_EMAIL: the stats payload for each of the four dashboard periods, beside the
// candidate listings, so whether a period's figures match its date range can be checked by hand.
require('dotenv').config();
const B = (process.env.DOC_API_BASE_URL || 'https://dev-api.talentforge.com.sa') + '/core/api/v1/';
(async () => {
  const r = await fetch(B + 'auth/token/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.AGENT_EMAIL, password: process.env.AGENT_PASSWORD }) });
  const { access } = await r.json();
  const get = async (p) => { const x = await fetch(B + p, { headers: { authorization: `Bearer ${access}` } }); return { status: x.status, body: await x.json().catch(() => null) }; };
  for (const p of ['monthly', 'quarterly', 'yearly', 'year-to-date']) console.log(p, JSON.stringify((await get(`candidate/stats/?period=${p}`)).body));
  for (const p of ['candidate/active/?page=1&page_size=3', 'candidate/requires-attention/?page=1&page_size=3', 'candidate/in-progress/?page=1&page_size=3']) {
    const x = await get(p); console.log('\n' + p, x.status, 'count', x.body && x.body.count, JSON.stringify(x.body && x.body.results && x.body.results[0]).slice(0, 900));
  }
})();
