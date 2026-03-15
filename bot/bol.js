import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import JSZip from 'jszip';

const execFileAsync = promisify(execFile);
const TEMPLATE_PATH = path.resolve(process.cwd(), 'BOL_template.docx');
const PLACEHOLDER = '{{TRA}}';

function sanitizeTrailer(value) {
  return String(value || '').trim();
}

async function convertDocxToPdf(inputDocxPath, outputDir) {
  const binary = process.platform === 'win32' ? 'soffice.exe' : 'soffice';
  try {
    await execFileAsync(binary, ['--headless', '--convert-to', 'pdf', '--outdir', outputDir, inputDocxPath], {
      timeout: 120000
    });
  } catch {
    throw new Error('LibreOffice (soffice) is required for DOCX->PDF conversion');
  }
}

async function fillTemplateDocx(templateBuffer, trailer) {
  const zip = await JSZip.loadAsync(templateBuffer);
  const xmlTargets = Object.keys(zip.files).filter((name) =>
    name === 'word/document.xml' ||
    /^word\/header\d+\.xml$/.test(name) ||
    /^word\/footer\d+\.xml$/.test(name)
  );

  let replacedCount = 0;

  for (const name of xmlTargets) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async('string');
    if (!xml.includes(PLACEHOLDER)) continue;
    const replaced = xml.replaceAll(PLACEHOLDER, trailer);
    const localCount = xml.split(PLACEHOLDER).length - 1;
    replacedCount += localCount;
    zip.file(name, replaced);
  }

  if (replacedCount === 0) {
    throw new Error(`Could not find placeholder ${PLACEHOLDER} in BOL_template.docx`);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
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

    const tempBase = path.join(tmpdir(), `bol_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const docxPath = `${tempBase}.docx`;
    const pdfGeneratedPath = `${tempBase}.pdf`;
    const pdfOutPath = path.join(tmpdir(), `BOL_${trailer}.pdf`);

    try {
      const filledDocx = await fillTemplateDocx(templateBuffer, trailer);
      await fs.writeFile(docxPath, filledDocx);
      await convertDocxToPdf(docxPath, tmpdir());

      await fs.rename(pdfGeneratedPath, pdfOutPath).catch(async () => {
        const maybeName = path.basename(docxPath).replace(/\.docx$/i, '.pdf');
        const maybePath = path.join(tmpdir(), maybeName);
        await fs.copyFile(maybePath, pdfOutPath);
      });

      out.push({ trailer, filePath: pdfOutPath, fileName: `BOL_${trailer}.pdf` });
    } finally {
      await fs.rm(docxPath, { force: true }).catch(() => {});
      await fs.rm(pdfGeneratedPath, { force: true }).catch(() => {});
    }
  }

  return out;
}
