import { promises as fs } from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'BOL_template.pdf');
const TRAILER_PLACEHOLDER = '563343';

function sanitizeTrailer(value) {
  return String(value || '').trim();
}

function replaceAllBufferOccurrences(buffer, needleAscii, replacementAscii) {
  const needle = Buffer.from(needleAscii, 'ascii');
  const replacement = Buffer.from(replacementAscii, 'ascii');
  if (needle.length !== replacement.length) {
    throw new Error('Replacement length must match placeholder length.');
  }

  const output = Buffer.from(buffer);
  let count = 0;
  let pos = 0;

  while (pos <= output.length - needle.length) {
    const found = output.indexOf(needle, pos);
    if (found === -1) break;
    replacement.copy(output, found);
    count += 1;
    pos = found + needle.length;
  }

  return { buffer: output, count };
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

  const out = [];

  for (const trailer of input) {
    if (!/^\d{6}$/.test(trailer)) {
      throw new Error('Trailer number must be exactly 6 digits.');
    }

    const { buffer, count } = replaceAllBufferOccurrences(templateBuffer, TRAILER_PLACEHOLDER, trailer);
    if (count < 2) {
      throw new Error(`Could not find "${TRAILER_PLACEHOLDER}" placeholders in BOL_template.pdf`);
    }

    const fileName = `BOL_${trailer}.pdf`;
    const filePath = path.join('/tmp', fileName);
    await fs.writeFile(filePath, buffer);
    out.push({ trailer, filePath, fileName });
  }

  return out;
}
