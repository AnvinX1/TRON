/**
 * TRON — Document Processor
 * Handles text extraction from PDF, DOCX, DOC, and image files.
 */
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

/**
 * Detect file type from extension
 */
export function detectFileType(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'pdf';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'].includes(ext)) return 'img';
  return 'unknown';
}

/**
 * Extract text from a PDF file
 */
async function extractPDF(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  let fullText = '';
  const pages = [];

  for (let i = 1; i <= totalPages; i++) {
    onProgress?.(`Extracting page ${i}/${totalPages}`);
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    pages.push({ pageNum: i, text: pageText });
    fullText += pageText + '\n\n';
  }

  // If very little text found, it might be a scanned PDF — try OCR on first page
  if (fullText.trim().length < 50 && totalPages > 0) {
    onProgress?.('Scanned PDF detected — running OCR...');
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const ocrResult = await runOCR(blob, onProgress);
    fullText = ocrResult;
    pages[0] = { pageNum: 1, text: ocrResult };
  }

  return { text: fullText.trim(), pages, pageCount: totalPages };
}

/**
 * Extract text from DOCX/DOC file
 */
async function extractDOCX(file, onProgress) {
  onProgress?.('Parsing document structure...');
  const arrayBuffer = await file.arrayBuffer();
  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { text: result.value.trim(), pages: [{ pageNum: 1, text: result.value.trim() }], pageCount: 1 };
  } catch (e) {
    // For .doc files mammoth may fail — return what we can
    onProgress?.('Legacy .doc format — attempting extraction...');
    try {
      const result = await mammoth.extractRawText({ arrayBuffer });
      return { text: result.value.trim(), pages: [{ pageNum: 1, text: result.value.trim() }], pageCount: 1 };
    } catch {
      throw new Error('Could not extract text from this document. Try converting to .docx first.');
    }
  }
}

/**
 * Run OCR on an image file or blob
 */
async function runOCR(fileOrBlob, onProgress) {
  onProgress?.('Running OCR engine...');
  const result = await Tesseract.recognize(fileOrBlob, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress?.(`OCR: ${Math.round(m.progress * 100)}%`);
      }
    },
  });
  return result.data.text;
}

/**
 * Extract text from an image file
 */
async function extractImage(file, onProgress) {
  onProgress?.('Preparing image for OCR...');
  const text = await runOCR(file, onProgress);
  return { text: text.trim(), pages: [{ pageNum: 1, text: text.trim() }], pageCount: 1 };
}

/**
 * Main extraction entry point
 */
export async function processDocument(file, onProgress) {
  const fileType = detectFileType(file.name);
  let result;

  switch (fileType) {
    case 'pdf':
      result = await extractPDF(file, onProgress);
      break;
    case 'docx':
      result = await extractDOCX(file, onProgress);
      break;
    case 'img':
      result = await extractImage(file, onProgress);
      break;
    default:
      throw new Error(`Unsupported file type: ${file.name}`);
  }

  return {
    fileName: file.name,
    fileType,
    fileSize: file.size,
    extractedText: result.text,
    pages: result.pages,
    pageCount: result.pageCount,
    processedAt: new Date().toISOString(),
  };
}
