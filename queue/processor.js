// const { Queue, Worker } = require('bullmq');
// const IORedis = require('ioredis');
// const axios = require('axios');
// const events = require('events');

// // avoid EventEmitter MaxListeners warnings in heavy-worker setups
// events.EventEmitter.defaultMaxListeners = Math.max(20, events.EventEmitter.defaultMaxListeners);

// const Document = require('../models/Document');
// const Chunk = require('../models/Chunk');
// const Embedding = require('../models/Embedding');

// const { generateEmbeddings } = require('../services/gemini');

// // optional vector store service (may be null)
// let upsertEmbeddings = null;
// try {
//   ({ upsertEmbeddings } = require('../services/vectorStore'));
// } catch (e) {
//   upsertEmbeddings = null;
//   console.warn('vectorStore.upsertEmbeddings not available — will skip external vector store upserts.');
// }

// // ======================
// // Embedded rechunk function (heading-aware)
// // ======================

// // Embedded rechunk function (heading-aware) — updated to use textPerPage fallback and persist fullText
// async function rechunkDocument(documentId, textPerPage = null) {
//   if (!documentId) throw new Error('documentId required for rechunkDocument');

//   // Load document
//   let doc = await Document.findById(documentId).lean().exec();
//   if (!doc) throw new Error('Document not found: ' + documentId);

//   // Prefer doc.fullText; if missing, fall back to provided textPerPage (OCR result)
//   let fullText = (doc.fullText || doc.text || '').toString().trim();

//   if (!fullText && Array.isArray(textPerPage) && textPerPage.length > 0) {
//     // use OCR textPerPage as fullText and persist it so DB has the fullText for later
//     fullText = textPerPage.join('\n').trim();
//     try {
//       await Document.findByIdAndUpdate(documentId, { fullText, pages: textPerPage.length }).exec();
//       console.log(`rechunkDocument: persisted fullText from textPerPage for document ${documentId}`);
//       // reload doc as lean copy (not strictly necessary but keeps consistency)
//       doc = await Document.findById(documentId).lean().exec();
//     } catch (e) {
//       console.warn('rechunkDocument: failed to persist fullText to Document record:', e && e.message ? e.message : e);
//       // continue — we still have fullText in memory
//     }
//   }

//   if (!fullText) {
//     throw new Error('Document has no text to rechunk: ' + documentId);
//   }

//   // Split into trimmed non-empty lines
//   const lines = fullText
//     .split(/\r?\n/)
//     .map((l) => l.trim())
//     .filter(Boolean);

//   const sections = [];
//   let current = { heading: 'Start', text: '' };

//   const flushSection = () => {
//     if (current.text && current.text.trim()) {
//       sections.push({ heading: current.heading || 'Untitled', text: current.text.trim() });
//     }
//     current = { heading: 'Untitled', text: '' };
//   };

//   // Heuristic heading detection:
//   // - All caps short lines, lines ending with ':', chapter/section patterns, or short lines with Title Case
//   for (const line of lines) {
//     const isAllCapsShort = line.length < 120 && /^[A-Z0-9 \-(),.]+$/.test(line) && /[A-Z]/.test(line) && /[a-z]/.test(line) === false;
//     const endsWithColon = /:$/.test(line);
//     const chapterLike = /^[Cc]hapter\s+\d+/.test(line) || /^[Ss]ection\s+\d+/.test(line);
//     const shortTitleCase = line.length < 60 && /^[A-Z][a-z]+/.test(line);

//     const isHeading = isAllCapsShort || endsWithColon || chapterLike || shortTitleCase;

//     if (isHeading) {
//       flushSection();
//       current.heading = line.replace(/:+$/, '').trim();
//     } else {
//       current.text += (current.text ? ' ' : '') + line;
//       // If a section grows too big, split it early to avoid huge chunks
//       if (current.text.length > 5000) {
//         flushSection();
//       }
//     }
//   }
//   flushSection();

//   // If no sections detected, create one with full text
//   if (!sections.length) {
//     sections.push({ heading: 'Document', text: fullText });
//   }

//   // Remove existing chunks for this document (we recreate from scratch)
//   await Chunk.deleteMany({ documentId }).exec();

//   // Parameters for sliding window
//   const windowSentences = parseInt(process.env.CHUNK_WINDOW_SENTENCES || '8', 10);
//   const overlapSentences = parseInt(process.env.CHUNK_OVERLAP_SENTENCES || '2', 10);

//   let chunkIndex = 0;
//   const toInsert = [];

//   // Helper to estimate pageNo from chunk position when textPerPage provided
//   const totalPages = Array.isArray(textPerPage) ? textPerPage.length : (doc.pages || 0);

//   for (const sec of sections) {
//     // Split section text into sentences (keep punctuation)
//     const sentences = sec.text
//       .split(/(?<=[.?!])\s+/)
//       .map((s) => s.trim())
//       .filter(Boolean);

//     if (!sentences.length) {
//       // if section has no sentence splits, still create a chunk from its text
//       const piece = sec.text.trim();
//       if (piece) {
//         const pageNo = totalPages ? Math.max(1, Math.min(totalPages, Math.floor((chunkIndex / Math.max(1, sections.length)) * totalPages) + 1)) : null;
//         toInsert.push({
//           documentId,
//           chunkIndex,
//           heading: sec.heading,
//           text: piece,
//           pageNo
//         });
//         chunkIndex++;
//       }
//       continue;
//     }

//     // Sliding window over sentences
//     for (let i = 0; i < sentences.length; i += (windowSentences - overlapSentences)) {
//       const slice = sentences.slice(i, i + windowSentences);
//       if (!slice.length) continue;
//       const piece = slice.join(' ');
//       const estimatedPageNo = totalPages
//         ? Math.max(1, Math.min(totalPages, Math.floor((chunkIndex / Math.max(1, Math.ceil(sentences.length / (windowSentences - overlapSentences)))) * totalPages) + 1))
//         : null;

//       toInsert.push({
//         documentId,
//         chunkIndex,
//         heading: sec.heading,
//         text: piece,
//         pageNo: estimatedPageNo
//       });

//       chunkIndex++;
//     }
//   }

//   if (!toInsert.length) {
//     throw new Error('Rechunk produced zero chunks for document: ' + documentId);
//   }

//   // Bulk insert chunks
//   await Chunk.insertMany(toInsert);

//   return { created: toInsert.length };
// }


// // ==============================
// // REDIS CONNECTION
// // ==============================
// if (!process.env.REDIS_HOST) {
//   console.warn('REDIS_HOST not set — using default "redis"');
// }

// const connection = new IORedis({
//   host: process.env.REDIS_HOST,
//   port: parseInt(process.env.REDIS_PORT || '6379', 10),
//   password: process.env.REDIS_PASSWORD,   // 🔥 ADD THIS
//   tls: {},                                // 🔥 VERY IMPORTANT (Upstash ke liye)
//   maxRetriesPerRequest: null,
//   enableReadyCheck: false
// });

// // ==============================
// // QUEUE INITIALIZATION
// // ==============================
// const QUEUE_NAME = process.env.DOC_QUEUE_NAME || 'document-processing';
// const documentQueue = new Queue(QUEUE_NAME, { connection });

// // ==============================
// // ADD JOB TO QUEUE
// // ==============================
// async function addDocumentProcessingJob(documentId, filePath) {
//   return documentQueue.add(
//     'process-document',
//     { documentId, filePath },
//     {
//       attempts: 3,
//       backoff: {
//         type: 'exponential',
//         delay: 3000
//       },
//       removeOnComplete: true,
//       removeOnFail: false
//     }
//   );
// }

// // ==============================
// // WORKER - PROCESS DOCUMENT
// // ==============================
// const workerConcurrency = Math.max(1, parseInt(process.env.DOC_WORKER_CONCURRENCY || '2', 10));

// const worker = new Worker(
//   QUEUE_NAME,
//   async (job) => {
//     const { documentId, filePath } = job.data;
//     console.log('📥 [worker] Processing Document:', documentId);
//     try {
//       await job.log(`start processing ${documentId}`);

//       // 1) mark processing
//       await Document.findByIdAndUpdate(documentId, { status: 'processing', errorMessage: null }).exec();

//       // 2) call OCR worker
//       if (!process.env.WORKER_URL) {
//         throw new Error('WORKER_URL is not configured');
//       }

//       const ocrResponse = await axios.post(
//         `${process.env.WORKER_URL.replace(/\/$/, '')}/process`,
//         { documentId, filePath },
//         { timeout: 1000 * 60 * 10 } // 10 minutes
//       );

//       const { pages, textPerPage } = ocrResponse.data || {};
//       if (!Array.isArray(textPerPage)) {
//         throw new Error('Invalid OCR response: textPerPage missing or not an array');
//       }

//       await job.log(`ocr done: pages=${pages}, pagesExtracted=${textPerPage.length}`);
//       console.log(`ocr done for ${documentId}: pages=${pages}, pagesExtracted=${textPerPage.length}`);

//       // 3) full text & auto-rechunk (heading-based) — save fullText first
//       const fullText = textPerPage.join('\n');
//       await Document.findByIdAndUpdate(documentId, { fullText, pages: pages || textPerPage.length }).exec();

//       // Run embedded rechunk now, passing textPerPage so pageNo estimation is better
//       try {
//         await job.log('starting embedded rechunkDocument (heading-based)');
//         const r = await rechunkDocument(documentId, textPerPage);
//         await job.log(`rechunkDocument complete: created ${r.created}`);
//         console.log('rechunkDocument result:', r);
//       } catch (reErr) {
//         console.error('Rechunking failed for document', documentId, reErr && (reErr.stack || reErr.message || reErr));
//         await job.log(`rechunkDocument failed: ${String(reErr)}`);
//         // continue — fallback will try to use existing chunks
//       }

//       // 4) Fetch chunks from DB (created by rechunkDocument or pre-existing)
//       let savedChunks = await Chunk.find({ documentId }).sort({ chunkIndex: 1 }).lean().exec();

//       // If no chunks, create fallback simple chunks so pipeline can continue
//       if (!Array.isArray(savedChunks) || savedChunks.length === 0) {
//         console.warn('No chunks found after rechunking; creating fallback simple chunks');
//         await job.log('no chunks after rechunking — creating fallback chunks');

//         const docFull = (await Document.findById(documentId).lean().exec()) || {};
//         const fallbackText = docFull.fullText || '';
//         if (!fallbackText || String(fallbackText).trim().length === 0) {
//           throw new Error('No chunks available after rechunking and no fullText present');
//         }

//         // simple sentence window fallback
//         const sentences = fallbackText.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
//         const windowSize = parseInt(process.env.CHUNK_WINDOW_SENTENCES || '8', 10);
//         const overlap = parseInt(process.env.CHUNK_OVERLAP_SENTENCES || '2', 10);

//         const fallbackChunks = [];
//         let idx = 0;
//         for (let i = 0; i < sentences.length; i += (windowSize - overlap)) {
//           const piece = sentences.slice(i, i + windowSize).join(' ');
//           if (!piece.trim()) continue;
//           fallbackChunks.push({
//             documentId,
//             chunkIndex: idx,
//             heading: 'Fallback',
//             text: piece,
//             pageNo: null
//           });
//           idx++;
//         }

//         if (!fallbackChunks.length) {
//           throw new Error('Fallback chunk generation produced nothing');
//         }

//         // insert fallback chunks
//         try {
//           await Chunk.insertMany(fallbackChunks);
//           await job.log(`inserted ${fallbackChunks.length} fallback chunks`);
//           console.log('Inserted fallback chunks count:', fallbackChunks.length);
//         } catch (insErr) {
//           console.error('Failed to insert fallback chunks:', insErr && (insErr.stack || insErr.message || insErr));
//           throw insErr;
//         }

//         savedChunks = await Chunk.find({ documentId }).sort({ chunkIndex: 1 }).lean().exec();
//       }

//       await job.log(`loaded ${savedChunks.length} chunks from DB`);
//       console.log(`loaded ${savedChunks.length} chunks for document ${documentId}`);

//       // Build text list in order to generate embeddings
//       const chunkTexts = savedChunks.map((c) => c.text || '');

//       // 5) embeddings
//       const embeddings = await generateEmbeddings(chunkTexts);
//       if (!Array.isArray(embeddings) || embeddings.length !== chunkTexts.length) {
//         throw new Error(`Embeddings length mismatch: expected ${chunkTexts.length}, got ${Array.isArray(embeddings) ? embeddings.length : typeof embeddings}`);
//       }
//       await job.log(`generated ${embeddings.length} embeddings`);
//       console.log(`generated ${embeddings.length} embeddings for ${documentId}`);

//       // 6) Save embeddings using bulkWrite (upsert by documentId + chunkId)
//       const embeddingOps = embeddings.map((vec, i) => {
//         const chunk = savedChunks[i];
//         const pageNo = chunk.pageNo || Math.floor((i * (pages || 1)) / savedChunks.length) + 1;
//         return {
//           updateOne: {
//             filter: { documentId, chunkId: chunk._id },
//             update: {
//               $set: {
//                 documentId,
//                 chunkId: chunk._id,
//                 embedding: Array.isArray(vec) ? vec : [],
//                 pageNo
//               }
//             },
//             upsert: true
//           }
//         };
//       });

//       if (embeddingOps.length > 0) {
//         const embResult = await Embedding.bulkWrite(embeddingOps, { ordered: false });
//         await job.log(`embedding bulkWrite result: ${JSON.stringify(summarizeBulkResult(embResult))}`);
//         console.log('embedding bulkWrite result:', summarizeBulkResult(embResult));
//       }

//       // 7) Optionally upsert into external vector store (if service provided)
//       if (typeof upsertEmbeddings === 'function') {
//         try {
//           const payload = embeddings.map((vec, i) => ({
//             documentId,
//             chunkIndex: savedChunks[i].chunkIndex,
//             chunkId: savedChunks[i]._id,
//             embedding: vec,
//             metadata: {
//               heading: savedChunks[i].heading || null,
//               pageNo: savedChunks[i].pageNo || Math.floor((i * (pages || 1)) / savedChunks.length) + 1
//             }
//           }));
//           await upsertEmbeddings(payload);
//           await job.log('upserted to external vector store');
//           console.log('upserted embeddings to external vector store');
//         } catch (vsErr) {
//           console.warn('vectorStore.upsertEmbeddings failed:', vsErr && vsErr.message ? vsErr.message : vsErr);
//           await job.log(`vectorStore upsert failed: ${String(vsErr)}`);
//         }
//       }

//       // 8) Update document to ready
//       await Document.findByIdAndUpdate(documentId, {
//         status: 'ready',
//         pages: pages || textPerPage.length,
//         errorMessage: null
//       }).exec();

//       await job.log('document processing completed successfully');
//       console.log('✅ Document processed successfully:', documentId);
//       return { success: true, documentId };
//     } catch (error) {
//       console.error('❌ Processing failed for:', documentId, error && (error.stack || error));
//       try {
//         await Document.findByIdAndUpdate(documentId, {
//           status: 'error',
//           errorMessage: String(error && error.message ? error.message : error)
//         }).exec();
//       } catch (updateErr) {
//         console.error('Failed to update document status after processing failure:', updateErr);
//       }
//       // rethrow so BullMQ can apply retries/backoff
//       throw error;
//     }
//   },
//   { connection, concurrency: workerConcurrency }
// );

// // helper: summarize bulkWrite result to simple counts
// function summarizeBulkResult(res) {
//   if (!res) return {};
//   return {
//     insertedCount: res.insertedCount || 0,
//     matchedCount: res.matchedCount || 0,
//     modifiedCount: res.modifiedCount || 0,
//     upsertedCount: res.upsertedCount || (res.upsertedIds ? Object.keys(res.upsertedIds).length : 0),
//     nInserted: res.nInserted || 0
//   };
// }

// module.exports = {
//   documentQueue,
//   addDocumentProcessingJob,
//   worker
// };


const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const axios = require('axios');
const events = require('events');

events.EventEmitter.defaultMaxListeners = Math.max(20, events.EventEmitter.defaultMaxListeners);

const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const Embedding = require('../models/Embedding');

const { generateEmbeddings } = require('../services/gemini');

let upsertEmbeddings = null;
try {
  ({ upsertEmbeddings } = require('../services/vectorStore'));
} catch (e) {
  upsertEmbeddings = null;
  console.warn('vectorStore not available');
}

// ==============================
// 🔥 REDIS CONNECTION (FIXED)
// ==============================
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// ==============================
// QUEUE
// ==============================
const QUEUE_NAME = process.env.DOC_QUEUE_NAME || 'document-processing';

const documentQueue = new Queue(QUEUE_NAME, { connection });

// ==============================
// ADD JOB
// ==============================
async function addDocumentProcessingJob(documentId, fileUrl) {
  console.log('🚀 Adding job:', documentId);
  return documentQueue.add('process-document', { documentId, fileUrl });
}

// ==============================
// WORKER
// ==============================
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { documentId } = job.data;

    console.log('📥 Processing:', documentId);

    try {
      const doc = await Document.findById(documentId);

      if (!doc) throw new Error('Document not found');
      if (!doc.fileUrl) throw new Error('fileUrl missing');

      const fileUrl = doc.fileUrl;

      await Document.findByIdAndUpdate(documentId, {
        status: 'processing',
        errorMessage: null
      });

      // ======================
      // 🔥 OCR CALL
      // ======================
      console.log('📡 Calling OCR:', fileUrl);

      const ocrResponse = await axios.post(
        `${process.env.WORKER_URL}/process`,
        { documentId, fileUrl },
        { timeout: 1000 * 60 * 10 }
      );

      const { pages, textPerPage } = ocrResponse.data;

      if (!Array.isArray(textPerPage)) {
        throw new Error('OCR failed - invalid response');
      }

      // ======================
      // SAVE TEXT
      // ======================
      const fullText = textPerPage.join('\n');

      await Document.findByIdAndUpdate(documentId, {
        fullText,
        pages: pages || textPerPage.length
      });

      // ======================
      // CHUNKS (FIXED)
      // ======================
      await Chunk.deleteMany({ documentId });

      const chunkDocs = await Chunk.insertMany(
        textPerPage.map((text, i) => ({
          documentId,
          chunkIndex: i,
          text,
          pageNo: i + 1
        }))
      );

      // ======================
      // EMBEDDINGS (FIXED)
      // ======================
      const texts = chunkDocs.map(c => c.text);
      const embeddings = await generateEmbeddings(texts);

      const ops = embeddings.map((vec, i) => ({
        updateOne: {
          filter: { documentId, chunkId: chunkDocs[i]._id },
          update: {
            $set: {
              documentId,
              chunkId: chunkDocs[i]._id,
              embedding: vec,
              pageNo: chunkDocs[i].pageNo
            }
          },
          upsert: true
        }
      }));

      await Embedding.bulkWrite(ops);

      // ======================
      // DONE
      // ======================
      await Document.findByIdAndUpdate(documentId, {
        status: 'ready'
      });

      console.log('✅ Done:', documentId);

    } catch (err) {
      console.error('❌ Error:', err.message);

      await Document.findByIdAndUpdate(documentId, {
        status: 'error',
        errorMessage: err.message
      });

      throw err;
    }
  },
  { connection }
);

module.exports = {
  documentQueue,
  addDocumentProcessingJob,
  worker
};