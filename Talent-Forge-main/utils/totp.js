// totp.js — RFC 6238 TOTP codes, computed from the secret THE APP ITSELF HANDS BACK.
//
// WHY THIS EXISTS, AND WHY 2FA IS NOT MOCKED
// Enabling 2FA posts to `/core/api/v1/auth/token/2fa/`, and that endpoint answers 201 with the
// shared secret in plaintext:
//   {"device_id":117,"otpauth_url":"otpauth://totp/<email>?secret=<BASE32>&algorithm=SHA1&
//     digits=6&period=30","manual_key":"<BASE32>","issuer":"TalentForge"}
// That is the same string the setup modal prints under the QR code for a human to type into
// Google Authenticator. So the suite can be the authenticator: read the secret off the modal (or
// off the response), compute the code the app is expecting, and submit it. Nothing is stubbed —
// the server validates the code it would validate for a real user, and a break in the app's own
// TOTP implementation still fails the test.
//
// The alternative — intercepting the verify call and forcing a 200 — was rejected. It would
// assert only that the UI reacts to a success it was handed, which is precisely the half of
// "enable 2FA" that is not worth testing.
//
// No dependency: `crypto` has HMAC-SHA1, and base32 is 30 lines. otplib/speakeasy would each add
// a runtime dependency to compute one HMAC.
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// RFC 4648 base32 -> Buffer. Tolerates lowercase, padding and the spaces authenticator apps
// print secrets with ("G7MV WIM5 NWIK ...").
function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean.length || /[^A-Z2-7]/.test(clean)) {
    throw new Error(`Not a base32 secret: "${input}"`);
  }
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

// HOTP (RFC 4226): HMAC the counter, then dynamic-truncate to `digits`.
function hotp(secret, counter, { digits = 6, algorithm = 'sha1' } = {}) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = crypto.createHmac(algorithm, base32Decode(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

// The code for a point in time. `offsetSeconds` shifts that point, which is how an EXPIRED code
// is produced honestly: -120s is four full 30s steps back, outside any sane server drift window,
// so the server rejects a code that was genuinely valid two minutes ago rather than a random one.
function totp(secret, { at = Date.now(), offsetSeconds = 0, period = 30, digits = 6, algorithm = 'sha1' } = {}) {
  const counter = Math.floor((at / 1000 + offsetSeconds) / period);
  return hotp(secret, counter, { digits, algorithm });
}

// Seconds left in the current step. A code submitted with <2s remaining can tick over between
// the suite computing it and the server checking it, so callers wait out the tail of the window
// rather than retrying a failure they caused themselves.
function secondsRemaining({ at = Date.now(), period = 30 } = {}) {
  return period - Math.floor(at / 1000) % period;
}

// Compute a code that is safe to submit: if the current step is about to end, wait for the next
// one first. Returns { code, waitedMs }.
async function freshTotp(secret, { period = 30, minRemaining = 3, opts = {} } = {}) {
  let waitedMs = 0;
  const left = secondsRemaining({ period });
  if (left < minRemaining) {
    waitedMs = (left + 1) * 1000;
    await new Promise((r) => setTimeout(r, waitedMs));
  }
  return { code: totp(secret, { period, ...opts }), waitedMs };
}

// A 6-digit code that is NOT valid for this secret in any nearby window. Picking a fixed string
// like "123456" risks colliding with the real code roughly once in a million runs, and a flake
// that rare is worse than one that never happens — it would be diagnosed as an app defect.
function invalidCode(secret, { windows = 4 } = {}) {
  const forbidden = new Set();
  for (let i = -windows; i <= windows; i++) {
    forbidden.add(totp(secret, { offsetSeconds: i * 30 }));
  }
  for (let n = 111111; n <= 999999; n++) {
    const candidate = String(n);
    if (!forbidden.has(candidate)) return candidate;
  }
  throw new Error('unreachable: no 6-digit code outside the valid windows');
}

// Pull the secret out of whatever the app gave us: the otpauth:// URL, the JSON body, or the
// bare manual key printed under the QR code.
function extractSecret(source) {
  if (!source) throw new Error('No source to extract a TOTP secret from');
  if (typeof source === 'object') {
    return extractSecret(source.manual_key || source.otpauth_url || '');
  }
  const text = String(source);
  const fromUrl = text.match(/[?&]secret=([A-Za-z2-7=]+)/);
  if (fromUrl) return fromUrl[1].toUpperCase();
  const bare = text.replace(/[\s-]/g, '').match(/\b[A-Z2-7]{16,}\b/);
  if (bare) return bare[0];
  throw new Error(`No base32 secret found in: ${text.slice(0, 120)}`);
}

module.exports = { totp, hotp, freshTotp, secondsRemaining, invalidCode, extractSecret, base32Decode };
