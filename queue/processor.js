const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const axios = require('axios');
const events = require('events');

events.EventEmitter.defaultMaxListeners = Math.max(
  20,
  events.EventEmitter.defaultMaxListeners
);

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

/**
 * ==============================
 * CONFIG
 * ==============================
 */
const QUEUE_NAME = process.env.DOC_QUEUE_NAME || 'document-processing';
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '1', 10);
const OCR_TIMEOUT = parseInt(process.env.OCR_TIMEOUT || `${1000 * 60 * 10}`, 10);

/**
 * ==============================
 * REDIS CONNECTION
 * ==============================
 */
const connection = new IORedis(process.env.REDIS_URL, {
  tls: {},
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

/**
 * ==============================
 * QUEUE
 * ==============================
 */
const documentQueue = new Queue(QUEUE_NAME, { connection });

/**
 * ==============================
 * HELPERS
 * ==============================
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callOCR(documentId, fileUrl) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(
        `${process.env.WORKER_URL}/process`,
        { documentId, fileUrl },
        { timeout: OCR_TIMEOUT }
      );

      return response;

    } catch (err) {
      const status = err?.response?.status;

      console.warn(`OCR attempt ${attempt} failed`, status || err.message);

      if (status === 429 && attempt < 3) {
        await sleep(15000 * attempt);
        continue;
      }

      if (!status && attempt < 3) {
        await sleep(5000);
        continue;
      }

      throw err;
    }
  }
}

/**
 * ==============================
 * ADD JOB
 * ==============================
 */
async function addDocumentProcessingJob(documentId, fileUrl) {
  console.log('🚀 Adding job:', documentId);

  return documentQueue.add(
    'process-document',
    { documentId, fileUrl },
    {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false
    }
  );
}

/**
 * ==============================
 * WORKER
 * ==============================
 */
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { documentId, fileUrl: jobFileUrl } = job.data;

    console.log('📥 Processing:', documentId);

    try {
      const doc = await Document.findById(documentId);

      if (!doc) throw new Error('Document not found');

      const fileUrl = jobFileUrl || doc.fileUrl;

      if (!fileUrl) throw new Error('fileUrl missing');

      await Document.findByIdAndUpdate(documentId, {
        status: 'processing',
        errorMessage: null
      });

      /**
       * ======================
       * OCR CALL
       * ======================
       */
      console.log('📡 Calling OCR:', fileUrl);

      const ocrResponse = await callOCR(documentId, fileUrl);

      if (!ocrResponse?.data?.success) {
        throw new Error('OCR service failed');
      }

      const { pages, textPerPage } = ocrResponse.data;

      if (!Array.isArray(textPerPage) || textPerPage.length === 0) {
        throw new Error('OCR returned empty or invalid text');
      }

      /**
       * ======================
       * SAVE TEXT
       * ======================
       */
      const fullText = textPerPage.join('\n');

      await Document.findByIdAndUpdate(documentId, {
        fullText,
        pages: pages || textPerPage.length
      });

      /**
       * ======================
       * CHUNKS
       * ======================
       */
      await Chunk.deleteMany({ documentId });
      await Embedding.deleteMany({ documentId });

      const filteredPages = textPerPage
        .map(t => (t || '').trim())
        .filter(t => t.length > 0);

      if (!filteredPages.length) {
        throw new Error('OCR returned empty text after filtering');
      }

      const chunkDocs = await Chunk.insertMany(
        filteredPages.map((text, i) => ({
          documentId,
          chunkIndex: i,
          text,
          pageNo: i + 1
        }))
      );

      /**
       * ======================
       * EMBEDDINGS
       * ======================
       */
      const texts = chunkDocs.map(c => c.text);

      const embeddings = await generateEmbeddings(texts);

      if (
        !Array.isArray(embeddings) ||
        embeddings.length !== texts.length
      ) {
        throw new Error('Embedding generation failed');
      }

      const ops = embeddings.map((vec, i) => ({
        updateOne: {
          filter: {
            documentId,
            chunkId: chunkDocs[i]._id
          },
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

      /**
       * OPTIONAL VECTOR STORE
       */
      if (upsertEmbeddings) {
        try {
          await upsertEmbeddings(documentId, chunkDocs, embeddings);
        } catch (e) {
          console.warn('Vector store skipped:', e.message);
        }
      }

      /**
       * ======================
       * DONE
       * ======================
       */
      await Document.findByIdAndUpdate(documentId, {
        status: 'ready',
        errorMessage: null
      });

      console.log('✅ Done:', documentId);

    } catch (err) {
      console.error('❌ Error:', err?.response?.data || err.message);

      await Document.findByIdAndUpdate(documentId, {
        status: 'error',
        errorMessage: err.message
      });

      throw err;
    }
  },
  {
    connection,
    concurrency: WORKER_CONCURRENCY
  }
);

/**
 * ==============================
 * EVENTS
 * ==============================
 */
worker.on('completed', job => {
  console.log(`🎉 Job completed: ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`💥 Job failed: ${job?.id}`, err.message);
});

/**
 * ==============================
 * EXPORTS
 * ==============================
 */
module.exports = {
  documentQueue,
  addDocumentProcessingJob,
  worker
};