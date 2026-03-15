import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import JSZip from 'jszip';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'BOL_template.docx');
const PLACEHOLDER = '{{TRA}}';
const CLOUDCONVERT_API = 'https://api.cloudconvert.com/v2';

function sanitizeTrailer(value) {
  return String(value || '').trim();
}

function getCloudConvertKey() {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) throw new Error('CLOUDCONVERT_API_KEY is required');
  return key;
}

async function cloudConvertRequest(apiKey, endpoint, options = {}) {
  const response = await fetch(`${CLOUDCONVERT_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = payload?.message || `CloudConvert request failed: ${response.status}`;
    throw new Error(msg);
  }

  return payload;
}

function taskListFromJob(job) {
  if (!job?.tasks) return [];
  return Array.isArray(job.tasks) ? job.tasks : Object.values(job.tasks);
}

async function waitForTaskForm(apiKey, taskId) {
  const timeoutMs = 60000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const taskResp = await cloudConvertRequest(apiKey, `/tasks/${taskId}`);
    const task = taskResp?.data;
    if (task?.status === 'error') throw new Error('CloudConvert import task failed');
    if (task?.result?.form?.url && task?.result?.form?.parameters) return task.result.form;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('CloudConvert import form timeout');
}

async function waitForJobFinished(apiKey, jobId) {
  const timeoutMs = 120000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const jobResp = await cloudConvertRequest(apiKey, `/jobs/${jobId}`);
    const job = jobResp?.data;
    if (job?.status === 'finished') return job;
    if (job?.status === 'error') throw new Error('CloudConvert job failed');
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error('CloudConvert job timeout');
}

async function convertDocxToPdfCloudConvert(docxBuffer, inputName) {
  const apiKey = getCloudConvertKey();

  const createJobPayload = {
    tasks: {
      'import-docx': { operation: 'import/upload' },
      'convert-to-pdf': {
        operation: 'convert',
        input: 'import-docx',
        input_format: 'docx',
        output_format: 'pdf'
      },
      'export-pdf': {
        operation: 'export/url',
        input: 'convert-to-pdf'
      }
    }
  };

  const created = await cloudConvertRequest(apiKey, '/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createJobPayload)
  });

  const job = created?.data;
  const importTask = taskListFromJob(job).find((task) => task.name === 'import-docx');
  if (!importTask?.id) throw new Error('CloudConvert import task not found');

  const form = importTask?.result?.form?.url
    ? importTask.result.form
    : await waitForTaskForm(apiKey, importTask.id);

  const uploadForm = new FormData();
  for (const [key, value] of Object.entries(form.parameters)) {
    uploadForm.append(key, String(value));
  }
  uploadForm.append('file', new Blob([docxBuffer]), inputName);

  const uploadRes = await fetch(form.url, {
    method: 'POST',
    body: uploadForm
  });
  if (!uploadRes.ok) {
    throw new Error(`CloudConvert upload failed: ${uploadRes.status}`);
  }

  const finishedJob = await waitForJobFinished(apiKey, job.id);
  const exportTask = taskListFromJob(finishedJob).find((task) => task.name === 'export-pdf');
  const downloadUrl = exportTask?.result?.files?.[0]?.url;
  if (!downloadUrl) {
    throw new Error('CloudConvert export URL not found');
  }

  const pdfRes = await fetch(downloadUrl);
  if (!pdfRes.ok) {
    throw new Error(`CloudConvert PDF download failed: ${pdfRes.status}`);
  }

  const pdfArrayBuffer = await pdfRes.arrayBuffer();
  return Buffer.from(pdfArrayBuffer);
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

    const tempDocxPath = path.join(tmpdir(), `BOL_${trailer}_${Date.now()}.docx`);
    const pdfOutPath = path.join(tmpdir(), `BOL_${trailer}.pdf`);

    try {
      const filledDocx = await fillTemplateDocx(templateBuffer, trailer);
      await fs.writeFile(tempDocxPath, filledDocx);

      const docxBuffer = await fs.readFile(tempDocxPath);
      const pdfBuffer = await convertDocxToPdfCloudConvert(docxBuffer, path.basename(tempDocxPath));
      await fs.writeFile(pdfOutPath, pdfBuffer);

      out.push({ trailer, filePath: pdfOutPath, fileName: `BOL_${trailer}.pdf` });
    } finally {
      await fs.rm(tempDocxPath, { force: true }).catch(() => {});
    }
  }

  return out;
}
