import { promises as fs } from 'fs';
import path from 'path';
import zlib from 'zlib';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'BOL_template.pdf');
const TRAILER_PLACEHOLDER = '563343';

function sanitizeTrailer(value) {
  return String(value || '').trim();
}

function replaceInLatin1Text(text, replacementAscii) {
  let count = 0;
  const out = [];
  let pos = 0;

  while (pos < text.length) {
    const idx = text.indexOf(TRAILER_PLACEHOLDER, pos);
    if (idx === -1) {
      out.push(text.slice(pos));
      break;
    }

    out.push(text.slice(pos, idx));

    let slotLen = TRAILER_PLACEHOLDER.length;
    const slotMax = 15;
    while (slotLen < slotMax && idx + slotLen < text.length) {
      const ch = text[idx + slotLen];
      if (ch !== ' ' && ch !== '\u0000') break;
      slotLen += 1;
    }

    const normalized = replacementAscii.length > slotLen
      ? replacementAscii.slice(0, slotLen)
      : replacementAscii.padEnd(slotLen, ' ');
    out.push(normalized);

    count += 1;
    pos = idx + slotLen;
  }

  return { text: out.join(''), count };
}

function replaceAllBufferOccurrences(buffer, needleAscii, replacementAscii) {
  const needle = Buffer.from(needleAscii, 'ascii');
  const output = Buffer.from(buffer);
  let count = 0;
  let pos = 0;

  while (pos <= output.length - needle.length) {
    const found = output.indexOf(needle, pos);
    if (found === -1) break;

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

function findStreams(buffer) {
  const streams = [];
  const streamToken = Buffer.from('stream');
  const endToken = Buffer.from('endstream');
  let from = 0;

  while (from < buffer.length) {
    const streamIdx = buffer.indexOf(streamToken, from);
    if (streamIdx === -1) break;

    let dataStart = streamIdx + streamToken.length;
    if (buffer[dataStart] === 0x0d && buffer[dataStart + 1] === 0x0a) dataStart += 2;
    else if (buffer[dataStart] === 0x0a) dataStart += 1;

    const endIdx = buffer.indexOf(endToken, dataStart);
    if (endIdx === -1) break;

    let dataEnd = endIdx;
    if (buffer[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (buffer[dataEnd - 1] === 0x0d) dataEnd -= 1;

    if (dataEnd > dataStart) streams.push({ start: dataStart, end: dataEnd });
    from = endIdx + endToken.length;
  }

  return streams;
}

function replaceInCompressedStreams(buffer, replacementAscii) {
  const output = Buffer.from(buffer);
  const streams = findStreams(output);
  let replacedTotal = 0;

  for (const s of streams) {
    const raw = output.subarray(s.start, s.end);
    let inflated;
    try {
      inflated = zlib.inflateSync(raw);
    } catch {
      continue;
    }

    const inflatedText = inflated.toString('latin1');
    if (!inflatedText.includes(TRAILER_PLACEHOLDER)) continue;

    const { text: replacedText, count } = replaceInLatin1Text(inflatedText, replacementAscii);
    if (!count) continue;

    const replacedInflated = Buffer.from(replacedText, 'latin1');

    let recompressed = null;
    const strategies = [
      zlib.constants.Z_DEFAULT_STRATEGY,
      zlib.constants.Z_FILTERED,
      zlib.constants.Z_HUFFMAN_ONLY,
      zlib.constants.Z_RLE
    ];
    for (const level of [9, 8, 7, 6, 5, 4, 3, 2, 1]) {
      for (const strategy of strategies) {
        const candidate = zlib.deflateSync(replacedInflated, { level, strategy });
        if (!recompressed || candidate.length < recompressed.length) recompressed = candidate;
      }
    }

    if (!recompressed || recompressed.length > raw.length) {
      continue;
    }

    recompressed.copy(output, s.start);
    output.fill(0x20, s.start + recompressed.length, s.end);
    replacedTotal += count;
  }

  return { buffer: output, count: replacedTotal };
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

    let resultBuffer = Buffer.from(templateBuffer);
    let replaced = 0;

    const direct = replaceAllBufferOccurrences(resultBuffer, TRAILER_PLACEHOLDER, trailer);
    resultBuffer = direct.buffer;
    replaced += direct.count;

    if (replaced === 0) {
      const compressed = replaceInCompressedStreams(resultBuffer, trailer);
      resultBuffer = compressed.buffer;
      replaced += compressed.count;
    }

    if (replaced === 0) {
      const asLatin1 = resultBuffer.toString('latin1');
      const fallback = replaceInLatin1Text(asLatin1, trailer);
      if (fallback.count > 0) {
        resultBuffer = Buffer.from(fallback.text, 'latin1');
        replaced += fallback.count;
      }
    }

    const fileName = `BOL_${trailer}.pdf`;
    const filePath = path.join('/tmp', fileName);
    await fs.writeFile(filePath, resultBuffer);
    out.push({ trailer, filePath, fileName, replaced: replaced > 0 });
  }

  return out;
}
