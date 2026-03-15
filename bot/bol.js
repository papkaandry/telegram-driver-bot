import { promises as fs } from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'BOL_template.pdf');

function sanitizeTrailer(value) {
  return String(value || '').trim();
}

function tryFixedLengthReplace(sourceBinary, trailer) {
  const preferredPlaceholder = process.env.BOL_TRAILER_PLACEHOLDER || '000000';

  const replaceSameLen = (input, needle, repl, max = 2) => {
    if (!needle) return { text: input, count: 0 };
    let text = input;
    let count = 0;
    let idx = text.indexOf(needle);
    const replacement = repl.length >= needle.length ? repl.slice(0, needle.length) : repl.padEnd(needle.length, ' ');

    while (idx !== -1 && count < max) {
      text = `${text.slice(0, idx)}${replacement}${text.slice(idx + needle.length)}`;
      count += 1;
      idx = text.indexOf(needle, idx + replacement.length);
    }

    return { text, count };
  };

  let result = replaceSameLen(sourceBinary, preferredPlaceholder, trailer, 2);
  if (result.count >= 2) return result;

  // fallback: replace first two numeric tokens with same length as trailer field
  const numericMatches = [...sourceBinary.matchAll(/\b\d{4,12}\b/g)];
  if (numericMatches.length < 2) return result;

  let text = sourceBinary;
  let offset = 0;
  let replaced = 0;
  for (const m of numericMatches) {
    if (replaced >= 2) break;
    const token = m[0];
    const start = m.index + offset;
    const replacement = trailer.length >= token.length ? trailer.slice(0, token.length) : trailer.padEnd(token.length, ' ');
    text = `${text.slice(0, start)}${replacement}${text.slice(start + token.length)}`;
    offset += replacement.length - token.length;
    replaced += 1;
  }

  return { text, count: replaced };
}

export async function generateBolPdfFiles(trailerNumbers = []) {
  const input = trailerNumbers.map(sanitizeTrailer).filter(Boolean);
  if (!input.length) return [];

  let templateBuffer;
  try {
    templateBuffer = await fs.readFile(TEMPLATE_PATH);
  } catch (error) {
    throw new Error(`Template not found at ${TEMPLATE_PATH}`);
  }

  const templateBinary = templateBuffer.toString('binary');
  const out = [];

  for (const trailer of input) {
    const { text, count } = tryFixedLengthReplace(templateBinary, trailer);
    if (count < 2) {
      throw new Error('Could not locate trailer placeholders in BOL_template.pdf');
    }

    const fileName = `BOL_${trailer}.pdf`;
    const filePath = path.join('/tmp', fileName);
    await fs.writeFile(filePath, Buffer.from(text, 'binary'));
    out.push({ trailer, filePath, fileName });
  }

  return out;
}
