/* eslint-disable no-console */
// make-exact-10mb-png.js — builds `images to upload for testing/Exact10MB.png`: a REAL
// photograph, in PNG, of exactly 10 x 1024 x 1024 = 10,485,760 bytes.
//
// WHY IT HAS TO EXIST AS A FILE. The exact-10 MB boundary scenario uploads to BOTH image
// fields, and `Exact10MB.jpg` covered only the JPG one. The PNG row had no registered fixture,
// so it fell through to the GENERATED path, which emits a 1x1 image — and this form runs every
// accepted upload through a crop modal, which a 1x1 image can leave open. The scenario then
// failed on the profile row and the report read "the app rejects exactly 10 MB", which is the
// opposite of what the app does.
//
// HOW. An existing real PNG photograph is padded with ONE tEXt chunk sized to hit the byte count
// exactly. tEXt is an ancillary chunk every decoder skips, so the file still decodes to the same
// photograph it started as — the same technique imageFixtures.js uses for its generated PNGs,
// applied to real image data instead of a single pixel.
//
// Re-run it if the source photograph is ever replaced. It is idempotent and verifies its own
// output before writing.
const fs = require('fs');
const path = require('path');

const MB = 1024 * 1024;
const TARGET = 10 * MB;
const DIR = path.join(__dirname, '..', 'images to upload for testing');
const SOURCE = path.join(DIR, 'larger than 5MB.png');
const OUT = path.join(DIR, 'Exact10MB.png');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

// Walk the chunk list properly rather than searching for the bytes "IEND" — that string can
// occur inside compressed image data, and splicing there would corrupt the file.
function findIendOffset(buf) {
  let off = 8; // past the 8-byte signature
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IEND') return off;
    off += 12 + len;
  }
  throw new Error('no IEND chunk found — the source is not a valid PNG');
}

const src = fs.readFileSync(SOURCE);
if (src.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error(`${SOURCE} is not a PNG`);
const iend = findIendOffset(src);

const KEYWORD = Buffer.from('Comment\0', 'ascii');
const CHUNK_OVERHEAD = 12; // length + type + crc
const padBytes = TARGET - src.length - CHUNK_OVERHEAD - KEYWORD.length;
if (padBytes < 0) {
  throw new Error(`"${path.basename(SOURCE)}" is already ${src.length} bytes, larger than the ${TARGET}-byte target`);
}

const chunk = pngChunk('tEXt', Buffer.concat([KEYWORD, Buffer.alloc(padBytes, 0x41)]));
const out = Buffer.concat([src.subarray(0, iend), chunk, src.subarray(iend)]);

if (out.length !== TARGET) throw new Error(`built ${out.length} bytes, wanted exactly ${TARGET}`);
// Re-walk the result so a malformed splice is caught here rather than by a red scenario.
findIendOffset(out);

fs.writeFileSync(OUT, out);
console.log(`Wrote ${OUT}`);
console.log(`  source     : ${path.basename(SOURCE)} (${src.length} bytes)`);
console.log(`  padding    : one tEXt chunk of ${padBytes} bytes, spliced before IEND`);
console.log(`  result     : ${out.length} bytes === ${TARGET} (${TARGET / MB} MB exactly)`);
