// spreadsheet.js — readers for the two files the Audit Logs Export menu produces.
//
// WHY THIS EXISTS AT ALL, AND WHY IT HAS NO DEPENDENCY. A download event is not evidence: it
// fires for any bytes at all, including an HTML error page served under the right name. The
// whole point of the export coverage is that the FILE holds the right columns and the right
// rows, so the file has to be parsed. There is no xlsx library in this repo and adding one for
// two readers is not worth it — `bulkCandidateFile.js` already writes a real .xlsx by hand for
// the same reason, so reading one by hand is the matching half.
//
// >>> BOTH READERS RETURN THE SAME SHAPE — { header: [...], rows: [[...]] } — ON PURPOSE. <<<
// The CSV and the XLSX are asserted by ONE step against ONE expectation. If each format had its
// own reader shape the two assertions would drift, and the interesting question ("do the two
// exports agree with each other?") could not be asked at all.

const fs = require('fs');
const zlib = require('zlib');

// ---------------------------------------------------------------- CSV

// A real RFC-4180 parser, not a `split(',')`.
//
// IT HAS TO BE. Every audit-log export contains at least three fields that carry a comma
// INSIDE a quoted value — Location ("Karachi, Pakistan"), Event Details ("reason: MANUAL,
// session_id: ...") and Metadata (a whole JSON object, with doubled "" quotes). Splitting on
// commas turns a 15-column row into 20-odd fragments, so the column count check fails and the
// failure describes a malformed export rather than a naive reader. Measured on the live file:
// row 1 of a default export splits into 20 pieces that way.
function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      // Swallow the \n of a \r\n so a CRLF file does not yield a blank row per line.
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // A file not ending in a newline still has a final field to flush.
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing blank lines only — a blank line in the MIDDLE would be a real defect and
  // must survive to be reported.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();

  return { header: rows[0] || [], rows: rows.slice(1) };
}

function readCsv(filePath) {
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------- XLSX

// Minimal ZIP central-directory-free reader: walk the local file headers.
//
// Good enough here and nowhere near a general unzip — it assumes no encryption and no ZIP64,
// both true of what this app emits (verified: 8 entries, deflate + stored). If it ever meets a
// file it cannot walk it THROWS naming the entry rather than returning a partial workbook,
// because a silently short read would look exactly like an export missing its rows.
function zipEntries(buf) {
  const out = {};
  const SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let i = 0;
  while ((i = buf.indexOf(SIG, i)) !== -1) {
    const method = buf.readUInt16LE(i + 8);
    const flags = buf.readUInt16LE(i + 6);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + elen;

    // Bit 3 means the sizes live in a trailing data descriptor, so csize here is 0 and this
    // walk cannot find the next entry. Nothing this app emits uses it; say so rather than
    // returning a truncated set.
    if (flags & 0x08) {
      throw new Error(
        `xlsx entry "${name}" uses a streaming data descriptor, which this reader does not `
        + 'support. The workbook was not read; do not treat this as an export defect.'
      );
    }

    let data = buf.slice(start, start + csize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error(`xlsx entry "${name}" uses compression method ${method}`);
    out[name] = data;
    i = start + csize;
  }
  return out;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Ampersand LAST, or "&amp;lt;" would decode twice.
    .replace(/&amp;/g, '&');
}

// Column letters -> 0-based index, so "AA3" lands at 26 rather than at wherever it happened to
// appear. Reading cells positionally instead would silently shift every column right of an
// omitted empty cell — and a sparse row is exactly what an export with a null field produces.
function colIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/) || [''])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(filePath) {
  const entries = zipEntries(fs.readFileSync(filePath));
  const sheetName = Object.keys(entries).find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  if (!sheetName) {
    throw new Error(
      `No worksheet in ${filePath}. Entries: ${Object.keys(entries).join(', ') || '(none)'}`
    );
  }
  const xml = entries[sheetName].toString('utf8');

  // Shared strings are optional — this app writes t="inlineStr" and ships no sharedStrings.xml
  // (measured). Support both anyway: a writer change to shared strings would otherwise turn
  // every cell into an empty string, i.e. report a full export as blank.
  let shared = [];
  if (entries['xl/sharedStrings.xml']) {
    shared = [...entries['xl/sharedStrings.xml'].toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1])).join(''));
  }

  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1])).join('');
      } else if (type === 's') {
        const idx = Number((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]);
        value = shared[idx] !== undefined ? shared[idx] : '';
      } else {
        value = decodeXmlEntities((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      }
      const at = ref ? colIndex(ref) : cells.length;
      cells[at] = value;
    }
    // A sparse array would hand `undefined` to a .trim() somewhere downstream.
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }

  return { header: rows[0] || [], rows: rows.slice(1) };
}

// ---------------------------------------------------------------- dispatch

// Read whichever format the path names, so a step can hold one expectation for both.
function readExport(filePath) {
  if (/\.xlsx$/i.test(filePath)) return readXlsx(filePath);
  if (/\.csv$/i.test(filePath)) return readCsv(filePath);
  throw new Error(`Unsupported export format: ${filePath}`);
}

// Header -> { columnName: value } per row, for assertions that name a column instead of
// counting to it. Verifying a field BY LABEL rather than by "does this value appear anywhere in
// the file" is the rule the receipt-PDF reader already follows, and for the same reason: an
// export can carry the right figure in one column and the wrong one in another, and a presence
// check passes on a document that contradicts itself.
function asObjects(parsed) {
  return parsed.rows.map((r) => {
    const o = {};
    parsed.header.forEach((h, i) => {
      o[h] = r[i] === undefined ? '' : r[i];
    });
    return o;
  });
}

module.exports = { parseCsv, readCsv, readXlsx, readExport, asObjects };
