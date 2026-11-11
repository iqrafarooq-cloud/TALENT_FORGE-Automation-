// docFixtureTemplates.js - the document templates the fixture generator builds from.
//
// Split out of make-doc-verification-fixtures.js once the generated set grew past two
// files. The PDF writer lives here too, so the generator script is a list of fixtures
// and nothing else.
//
// Everything is plain PDF 1.4 with base-14 fonts and no compression, matching the
// hand-made fixtures already in Files/Test_doc so the whole set stays diff-able and
// readable by the same pdf-parse reader the suite uses.

'use strict';

const PAGE_W = 595;
const PAGE_H = 842;

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const FONTS = {
  F1: 'Helvetica',
  F2: 'Helvetica-Bold',
  F3: 'Times-Roman',
  F4: 'Times-Bold',
  F5: 'Courier-Bold',
};

class Content {
  constructor() {
    this.ops = [];
  }

  text(x, y, str, { font = 'F1', size = 11, gray = 0 } = {}) {
    this.ops.push(`BT ${gray} ${gray} ${gray} rg /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(str)}) Tj ET`);
    return this;
  }

  rotatedText(x, y, str, { font = 'F2', size = 28, deg = 22, rgb = [0.75, 0.1, 0.1] } = {}) {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r).toFixed(5);
    const s = Math.sin(r).toFixed(5);
    this.ops.push(`BT ${rgb.join(' ')} rg /${font} ${size} Tf ${c} ${s} ${-s} ${c} ${x} ${y} Tm (${esc(str)}) Tj ET`);
    return this;
  }

  rect(x, y, w, h, { rgb = [1, 1, 1] } = {}) {
    this.ops.push(`${rgb.join(' ')} rg ${x} ${y} ${w} ${h} re f`);
    return this;
  }

  line(x1, y1, x2, y2, { width = 0.6, rgb = [0.55, 0.55, 0.55] } = {}) {
    this.ops.push(`${rgb.join(' ')} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
    return this;
  }

  strokeRect(x, y, w, h, { width = 1.6, rgb = [0.75, 0.1, 0.1] } = {}) {
    this.ops.push(`${rgb.join(' ')} RG ${width} w ${x} ${y} ${w} ${h} re S`);
    return this;
  }

  toString() {
    return this.ops.join('\n');
  }
}

// Assemble a one-page PDF. xref entries are byte offsets, so the body is measured as it
// is built.
function buildPdf(content) {
  const stream = content.toString();
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << ${Object.keys(FONTS).map((k, i) => `/${k} ${5 + i} 0 R`).join(' ')} >> >> ` +
      '/Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    ...Object.values(FONTS).map((f) => `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`),
  ];

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(out, 'latin1');
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const DEFAULT_INSTITUTION = 'King Saud University';
const DEFAULT_COMPANY = 'Systems Limited Pakistan';

// An academic transcript. Every field is optional so the "missing X" fixtures are the
// same template with a field left out, rather than four near-copies of a layout.
function transcript({
  institution = DEFAULT_INSTITUTION,
  name,
  degree = 'Bachelor of Science in Computer Science',
  major = 'Software Engineering',
  conferral = '15 June 2022',
  issue = null,
  footer = true,
} = {}) {
  const c = new Content();
  let y = PAGE_H - 90;
  if (institution) {
    c.text(70, y, institution, { font: 'F2', size: 16 });
    y -= 34;
  }
  c.text(70, y, 'OFFICIAL ACADEMIC TRANSCRIPT', { font: 'F2', size: 13 });
  y -= 46;
  if (name) { c.text(70, y, `Student Name: ${name}`); y -= 24; }
  if (degree) { c.text(70, y, `Degree: ${degree}`); y -= 24; }
  if (major) { c.text(70, y, `Major / Field: ${major}`); y -= 24; }
  if (conferral) { c.text(70, y, `Date of Conferral: ${conferral}`); y -= 24; }
  if (issue) { c.text(70, y, `Issue Date: ${issue}`); y -= 24; }
  if (footer) {
    y -= 12;
    c.text(70, y, 'This document certifies that the above-named student has completed the prescribed', { size: 10 });
    c.text(70, y - 14, 'course of study and has been awarded the stated degree with all the rights and', { size: 10 });
    c.text(70, y - 28, 'privileges pertaining thereto.', { size: 10 });
  }
  c.text(70, 60, '-- 1 of 1 --', { size: 9, gray: 0.4 });
  return buildPdf(c);
}

function certificate({
  institution = DEFAULT_INSTITUTION,
  name,
  title,
  issue,
  expiry = null,
  extraLines = [],
} = {}) {
  const c = new Content();
  let y = PAGE_H - 90;
  c.text(70, y, institution, { font: 'F2', size: 16 });
  y -= 34;
  c.text(70, y, 'CERTIFICATE OF COMPLETION', { font: 'F2', size: 13 });
  y -= 46;
  c.text(70, y, `Presented to: ${name}`);
  y -= 24;
  c.text(70, y, title);
  y -= 24;
  if (issue) { c.text(70, y, `Issue Date: ${issue}`); y -= 24; }
  if (expiry) { c.text(70, y, `Expiry Date: ${expiry}`); y -= 24; }
  for (const line of extraLines) { c.text(70, y, line, { size: 10, gray: 0.25 }); y -= 16; }
  c.text(70, 60, '-- 1 of 1 --', { size: 9, gray: 0.4 });
  return buildPdf(c);
}

function workLetter({ company = DEFAULT_COMPANY, name, designation, from, to = null, ongoing = false } = {}) {
  const c = new Content();
  let y = PAGE_H - 90;
  c.text(70, y, company, { font: 'F2', size: 16 });
  y -= 34;
  c.text(70, y, 'EMPLOYMENT VERIFICATION LETTER', { font: 'F2', size: 13 });
  y -= 46;
  c.text(70, y, 'To Whom It May Concern,');
  y -= 28;
  if (ongoing) {
    c.text(70, y, `This letter is to confirm that ${name} is currently employed with`);
    y -= 18;
    c.text(70, y, `${company} as a ${designation}.`);
    y -= 28;
    c.text(70, y, `Date of Joining: ${from}`);
    y -= 18;
    c.text(70, y, 'End of Employment: Present (no end date - employment is ongoing)');
    y -= 30;
    c.text(70, y, 'The employee remains in active service as at the date of this letter, and no');
    y -= 18;
    c.text(70, y, 'termination or end date has been agreed.');
    y -= 34;
  } else {
    c.text(70, y, `This letter is to confirm that ${name} was employed with ${company}`);
    y -= 18;
    c.text(70, y, `as a ${designation} from ${from} to ${to}.`);
    y -= 28;
    c.text(70, y, 'During their tenure, the employee demonstrated professionalism and dedication.');
    y -= 34;
  }
  c.text(70, y, 'Sincerely,');
  y -= 18;
  c.text(70, y, 'Human Resources Department');
  y -= 16;
  c.text(70, y, company);
  c.text(70, 60, '-- 1 of 1 --', { size: 9, gray: 0.4 });
  return buildPdf(c);
}

// An e-transcript carrying a digital-certificate block whose validation FAILED. The
// distinction from AUTH-03 matters: AUTH-03 has no certificate at all, this one has a
// certificate that does not validate, and the AC treats those as different states
// ("must have a VALID digital certificate").
function eTranscriptInvalidCertificate({ name }) {
  const c = new Content();
  let y = PAGE_H - 90;
  c.text(70, y, DEFAULT_INSTITUTION, { font: 'F2', size: 16 });
  y -= 34;
  c.text(70, y, 'OFFICIAL E-TRANSCRIPT (DIGITALLY SIGNED)', { font: 'F2', size: 13 });
  y -= 46;
  c.text(70, y, `Student Name: ${name}`);
  y -= 24;
  c.text(70, y, 'Degree: Bachelor of Science in Computer Science');
  y -= 24;
  c.text(70, y, 'Major / Field: Software Engineering');
  y -= 24;
  c.text(70, y, 'Date of Conferral: 15 June 2022');
  y -= 44;

  // The signature panel, rendered as a failed validation the way a PDF reader shows one.
  c.rect(64, y - 96, PAGE_W - 128, 104, { rgb: [0.99, 0.94, 0.94] });
  c.strokeRect(64, y - 96, PAGE_W - 128, 104, { width: 1.1, rgb: [0.75, 0.15, 0.15] });
  c.text(78, y - 18, 'DIGITAL SIGNATURE VALIDATION: INVALID', { font: 'F2', size: 12, gray: 0 });
  c.text(78, y - 38, 'Signer: Office of the Registrar, King Saud University', { size: 10, gray: 0.2 });
  c.text(78, y - 54, 'Certificate status: REVOKED - chain could not be validated', { font: 'F5', size: 9, gray: 0.2 });
  c.text(78, y - 70, 'Document has been altered since it was signed.', { font: 'F5', size: 9, gray: 0.2 });
  c.text(78, y - 86, 'Signature hash mismatch (SHA-256).', { font: 'F5', size: 9, gray: 0.2 });
  c.text(70, 60, '-- 1 of 1 --', { size: 9, gray: 0.4 });
  return buildPdf(c);
}

// A structurally valid, entirely empty page. Not a zero-byte file: the point is a
// document the parser can open and the model can render, containing nothing to verify.
function blankDocument() {
  return buildPdf(new Content());
}

module.exports = {
  PAGE_W,
  PAGE_H,
  FONTS,
  Content,
  buildPdf,
  transcript,
  certificate,
  workLetter,
  eTranscriptInvalidCertificate,
  blankDocument,
  DEFAULT_INSTITUTION,
  DEFAULT_COMPANY,
};
