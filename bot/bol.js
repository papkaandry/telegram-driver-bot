import { promises as fs } from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'BOL_template.pdf');
const PLACEHOLDER = '{{TRA}}';

function sanitizeTrailer(value) {
  return String(value || '').trim();
}

function replaceAllAscii(buffer, needle, replacement) {
  const src = Buffer.from(buffer);
  const find = Buffer.from(needle, 'ascii');
  const out = Buffer.from(replacement, 'ascii');
  let count = 0;
  let pos = 0;

  while (pos <= src.length - find.length) {
    const idx = src.indexOf(find, pos);
    if (idx === -1) break;
    const slotLen = find.length;
    const normalized = out.length >= slotLen
      ? out.subarray(0, slotLen)
      : Buffer.concat([out, Buffer.from(' '.repeat(slotLen - out.length), 'ascii')]);
    normalized.copy(src, idx);
    count += 1;
    pos = idx + slotLen;
  }

  return { buffer: src, count };
}

function toUtf16BeBytes(text) {
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  return be;
}

function replaceAllUtf16Be(buffer, needle, replacement) {
  const src = Buffer.from(buffer);
  const find = toUtf16BeBytes(needle);
  const out = toUtf16BeBytes(replacement);
  let count = 0;
  let pos = 0;

  while (pos <= src.length - find.length) {
    const idx = src.indexOf(find, pos);
    if (idx === -1) break;
    const slotLen = find.length;
    const normalized = out.length >= slotLen
      ? out.subarray(0, slotLen)
      : Buffer.concat([out, Buffer.alloc(slotLen - out.length, 0x00)]);
    normalized.copy(src, idx);
    count += 1;
    pos = idx + slotLen;
  }

  return { buffer: src, count };
}

export async function generateBolPdfFiles(trailerNumbers = []) {
  const input = trailerNumbers.map(sanitizeTrailer).filter(Boolean);
  if (!input.length) return [];

  let templateBuffer;
  try {
    templateBuffer = await fs.readFile(TEMPLATE_PATH);
  } catch {
    throw new Error(`Template not found at ${TEMPLATE_PATH}`);
  }

  const out = [];

  for (const trailer of input) {
    if (!/^[^\s]{1,15}$/u.test(trailer)) {
      throw new Error('Trailer value must be 1..15 characters without spaces.');
    }

    const asciiAttempt = replaceAllAscii(templateBuffer, PLACEHOLDER, trailer);
    let resultBuffer = asciiAttempt.buffer;
    let replaced = asciiAttempt.count;

    if (replaced === 0) {
      const utf16Attempt = replaceAllUtf16Be(templateBuffer, PLACEHOLDER, trailer);
      resultBuffer = utf16Attempt.buffer;
      replaced = utf16Attempt.count;
    }

    if (replaced === 0) {
      throw new Error(`Could not find placeholder ${PLACEHOLDER} in BOL_template.pdf`);
    }

    const fileName = `BOL_${trailer}.pdf`;
    const filePath = path.join('/tmp', fileName);
    await fs.writeFile(filePath, resultBuffer);
    out.push({ trailer, filePath, fileName });
  }

  return out;
}
