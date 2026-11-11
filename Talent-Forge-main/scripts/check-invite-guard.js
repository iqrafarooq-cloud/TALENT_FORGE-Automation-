// check-invite-guard.js - exercise the fixture-safety rule that decides whether a candidate
// invitation may be sent as a given agent, in BOTH directions.
//
// It exists because the rule's predecessor was never tested and did not do its job: on 2026-08-27
// a real invitation went out as the shared zero-candidate fixture and spent it permanently, since
// a candidate cannot be deleted. Costs nothing - pure logic, no browser, no network.
require('dotenv').config();
const { isInvitableAgent } = require('../utils/candidateInviteProvision');

const FIXTURE = process.env.NO_CANDIDATE_AGENT_EMAIL || 'iqra.farooq+nocand@bytecorp.io';
const SHARED = process.env.AGENT_EMAIL || 'faran.mustafa@bytecorp.io';
const THROWAWAY = 'iqra.farooq+welcomeonbxyz@bytecorp.io';

const cases = [
  ['the throwaway this scenario minted', { current: THROWAWAY, throwaway: THROWAWAY, allowList: [SHARED] }, true],
  ['the shared agent, on the allow-list', { current: SHARED, throwaway: null, allowList: [SHARED] }, true],
  ['same, differing only in case', { current: SHARED.toUpperCase(), throwaway: null, allowList: [SHARED] }, true],
  ['>>> THE ZERO-CANDIDATE FIXTURE (the case that went wrong)', { current: FIXTURE, throwaway: null, allowList: [SHARED] }, false],
  ['the fixture, while a DIFFERENT throwaway exists', { current: FIXTURE, throwaway: THROWAWAY, allowList: [SHARED] }, false],
  ['REFERRAL_NOPROMO_AGENT', { current: process.env.REFERRAL_NOPROMO_AGENT_EMAIL, throwaway: null, allowList: [SHARED] }, false],
  ['a promo fixture', { current: process.env.PROMO_LIMITED_AGENT_EMAIL, throwaway: null, allowList: [SHARED] }, false],
  ['nobody signed in', { current: '', throwaway: THROWAWAY, allowList: [SHARED] }, false],
  ['an empty allow-list and no throwaway', { current: SHARED, throwaway: null, allowList: [] }, false],
  ['a blank entry in the allow-list must not match a blank agent', { current: '', throwaway: null, allowList: ['', null] }, false],
];

let failed = 0;
for (const [label, input, wantAllowed] of cases) {
  const got = isInvitableAgent(input);
  const ok = got.allowed === wantAllowed;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${wantAllowed ? 'allow' : 'refuse'}  ${label}`
    + `\n         -> allowed=${got.allowed} (${got.reason})`
  );
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
