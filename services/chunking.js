// backend/services/chunking.js
// FINAL: Heading + Topic aware chunking for OCR documents
// Works for books, notes, CVs, exam PDFs, Hindi/English mix

function normalizeText(text) {
  if (!text) return '';

  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Detect headings / section titles
 * Examples:
 *  - OBJECTIVE:
 *  - CAREER PROFILE
 *  - 1. Introduction
 *  - CHAPTER 2
 */
function isHeading(line) {
  if (!line) return false;

  const clean = line.trim();

  if (clean.length < 3 || clean.length > 120) return false;

  // ALL CAPS headings
  if (/^[A-Z][A-Z\s\-&]{3,}$/.test(clean)) return true;

  // Ends with colon
  if (clean.endsWith(':')) return true;

  // Numbered headings
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(clean)) return true;

  // Chapter / Unit
  if (/^(chapter|unit|section)\s+\d+/i.test(clean)) return true;

  return false;
}

/**
 * Sentence-level fallback splitter
 */
function splitBySentences(text, maxLen) {
  const sentences = text.split(/(?<=[.?!।])\s+/);
  const chunks = [];

  let buffer = '';

  for (const s of sentences) {
    if ((buffer + ' ' + s).length <= maxLen) {
      buffer += (buffer ? ' ' : '') + s;
    } else {
      if (buffer) chunks.push(buffer.trim());
      buffer = s;
    }
  }

  if (buffer.trim()) chunks.push(buffer.trim());

  return chunks;
}

/**
 * MAIN CHUNK FUNCTION
 */
function splitIntoChunks(text, chunkSize = 300, overlap = 80) {
  const cleanText = normalizeText(text);
  if (!cleanText) return [];

  const lines = cleanText.split('\n');
  const rawChunks = [];

  let current = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // New heading → flush current chunk
    if (isHeading(line) && current.length > 0) {
      rawChunks.push(current.trim());
      current = line;
      continue;
    }

    current += (current ? '\n' : '') + line;

    // If chunk too big → flush
    if (current.length >= chunkSize) {
      rawChunks.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) rawChunks.push(current.trim());

  // ===== SECOND PASS: refine large chunks =====
  const refined = [];

  for (const ch of rawChunks) {
    if (ch.length <= chunkSize * 1.2) {
      refined.push(ch);
    } else {
      // split long sections by sentence
      const parts = splitBySentences(ch, chunkSize);
      refined.push(...parts);
    }
  }

  // ===== OVERLAP LOGIC =====
  const finalChunks = [];
  for (let i = 0; i < refined.length; i++) {
    let chunk = refined[i];

    if (i > 0 && overlap > 0) {
      const prev = refined[i - 1];
      const overlapText = prev.slice(-overlap);
      chunk = overlapText + '\n' + chunk;
    }

    finalChunks.push(chunk.trim());
  }

  // ===== REMOVE VERY SMALL / DUPLICATES =====
  const MIN_LEN = 60;
  const unique = [];
  let last = '';

  for (const c of finalChunks) {
    if (c.length < MIN_LEN && unique.length > 0) {
      unique[unique.length - 1] += '\n' + c;
    } else if (c !== last) {
      unique.push(c);
      last = c;
    }
  }

  return unique;
}

module.exports = {
  splitIntoChunks
};
