import { promises as fs } from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'BOL_template.pdf');
const TRAILER_PLACEHOLDER = '563343';

function sanitizeTrailer(value) {
  return String(value || '').trim();
}

function replaceAllBufferOccurrences(buffer, needleAscii, replacementAscii) {
  const needle = Buffer.from(needleAscii, 'ascii');
  const output = Buffer.from(buffer);
  let count = 0;
  let pos = 0;

  while (pos <= output.length - needle.length) {
    const found = output.indexOf(needle, pos);
    if (found === -1) break;

    // support variable length while keeping PDF byte size stable:
    // extend writable slot with trailing spaces/nulls (up to 15 total)
    let slotLen = needle.length;
    const slotMax = 15;
    while (slotLen < slotMax && found + slotLen < output.length) {
      const nextByte = output[found + slotLen];
      if (nextByte !== 0x20 && nextByte !== 0x00) break;
      slotLen += 1;
    }

    const normalized = replacementAscii.length > slotLen
      ? replacementAscii.slice(0, slotLen)
      : replacementAscii.padEnd(slotLen, ' ');

    const replacement = Buffer.from(normalized, 'ascii');
    replacement.copy(output, found);
    count += 1;
    pos = found + slotLen;
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
    if (!/^[^\s]{1,15}$/u.test(trailer)) {
      throw new Error('Trailer value must be 1..15 characters without spaces.');
    }

    let resultBuffer = templateBuffer;
    const { buffer, count } = replaceAllBufferOccurrences(templateBuffer, TRAILER_PLACEHOLDER, trailer);
    if (count >= 1) resultBuffer = buffer;

    const fileName = `BOL_${trailer}.pdf`;
    const filePath = path.join('/tmp', fileName);
    await fs.writeFile(filePath, resultBuffer);
    out.push({ trailer, filePath, fileName, replaced: count >= 1 });
  }

  return out;
}
