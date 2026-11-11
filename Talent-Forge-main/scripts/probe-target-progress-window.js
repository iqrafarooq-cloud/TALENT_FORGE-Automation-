// Which time window does each Target Progress period of the SuperAdmin agent profile count?
// Read-only. For the agents holding the most candidates, fetches
// GET /agent/<id>/target-progress/?duration=<d> for every period beside the agent's candidates
// with their dates, and counts the candidates inside each candidate window, so the window the
// server uses can be identified by which count matches.
//   node scripts/probe-target-progress-window.js [agentsToCheck=6]
require('dotenv').config();
const API = `${process.env.DOC_API_BASE_URL || 'https://dev-api.talentforge.com.sa'}/core/api/v1`;
const N = Number(process.argv[2] || 6);

async function call(token, path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const DURATIONS = ['current_month', 'last_quarter', 'yearly', 'ytd'];

(async () => {
  const login = await fetch(`${API}/auth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SUPERADMIN_EMAIL, password: process.env.SUPERADMIN_PASSWORD }),
  });
  const token = (await login.json()).access;
  if (!token) throw new Error(`superadmin login failed: ${login.status}`);

  const list = await call(token, '/agent/?status=ACTIVE&status=ATTENTION&page=1&page_size=100');
  const agents = (list.body.results || [])
    .map((a) => ({ id: a.id, email: a.email, count: a.total_candidate_count || 0, raw: a }))
    .sort((a, b) => b.count - a.count).slice(0, N);

  const now = new Date();
  for (const a of agents) {
    const tp = {};
    for (const d of DURATIONS) tp[d] = (await call(token, `/agent/${a.id}/target-progress/?duration=${d}`)).body;
    const cands = [];
    for (let page = 1; page < 30; page += 1) {
      const r = await call(token, `/agent/${a.id}/candidates/?page=${page}&page_size=100`);
      const res = (r.body && r.body.results) || [];
      cands.push(...res);
      if (!r.body || !r.body.next) break;
    }
    console.log(`\n=== agent ${a.id} ${a.email}: ${cands.length} candidates`);
    console.log('  target-progress:', JSON.stringify(tp));
    if (cands[0]) {
      const dateKeys = Object.entries(cands[0]).filter(([, v]) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)).map(([k]) => k);
      console.log('  candidate keys:', Object.keys(cands[0]).join(','), '| date keys:', dateKeys.join(','));
      for (const key of dateKeys) {
        const dates = cands.map((c) => c[key]).filter(Boolean).map((v) => new Date(v));
        const inRange = (from, to) => dates.filter((d) => d >= from && d < to).length;
        const y = now.getUTCFullYear(); const m = now.getUTCMonth();
        const q0 = Math.floor(m / 3) * 3;
        const W = {
          thisMonth: [new Date(Date.UTC(y, m, 1)), now],
          thisQuarter: [new Date(Date.UTC(y, q0, 1)), now],
          prevCalendarQuarter: [new Date(Date.UTC(y, q0 - 3, 1)), new Date(Date.UTC(y, q0, 1))],
          last3FullMonths: [new Date(Date.UTC(y, m - 3, 1)), new Date(Date.UTC(y, m, 1))],
          last4FullMonths: [new Date(Date.UTC(y, m - 4, 1)), new Date(Date.UTC(y, m, 1))],
          trailing90d: [new Date(now - 90 * 864e5), now],
          trailing120d: [new Date(now - 120 * 864e5), now],
          last3MonthsInclCurrent: [new Date(Date.UTC(y, m - 2, 1)), now],
          last4MonthsInclCurrent: [new Date(Date.UTC(y, m - 3, 1)), now],
          thisYear: [new Date(Date.UTC(y, 0, 1)), now],
          trailing365d: [new Date(now - 365 * 864e5), now],
        };
        console.log(`  by ${key}: ` + Object.entries(W).map(([k, [f, t]]) => `${k}=${inRange(f, t)}`).join(' '));
        const months = {};
        for (const d of dates) { const k = d.toISOString().slice(0, 7); months[k] = (months[k] || 0) + 1; }
        console.log(`  per month (${key}): ${JSON.stringify(months)}`);
      }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
