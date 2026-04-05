// File: backend/routes/worker.js
// Worker diagnostics + optional async OCR callback.
// Fully improved & made consistent with queue/processor.js pipeline.

const express = require('express');
const router = express.Router();

const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const Embedding = require('../models/Embedding');

const { splitIntoChunks } = require('../services/chunking');
const { generateEmbeddings } = require('../services/gemini');

let upsertVectorStore = null;
try {
    ({ upsertEmbeddings: upsertVectorStore } = require('../services/vectorStore'));
} catch (e) {
    upsertVectorStore = null;
    console.warn("vectorStore.upsertEmbeddings not available in worker route.");
}

const WORKER_URL = process.env.WORKER_URL || 'http://worker:5001';

// ==============================
// GET /api/worker/health
// ==============================
router.get('/health', (req, res) => {
    return res.status(200).json({
        success: true,
        message: 'Worker route active',
        workerUrl: WORKER_URL
    });
});

// ==============================
// INTERNAL HELPER — safe pipeline
// ==============================
async function processOCRCallback(documentId, pages, textPerPage) {
    // 1) Document must exist
    const doc = await Document.findById(documentId);
    if (!doc) throw new Error(`Document ${documentId} not found`);

    // 2) Optional: only allow callback when status != ready
    if (doc.status === 'ready') {
        console.warn(`⚠️ Callback received for a document already marked ready: ${documentId}`);
        // You may choose to ignore or reprocess; here we ignore to avoid duplication.
        return { skipped: true };
    }

    // 3) Clean existing old chunks/embeddings (safe)
    await Chunk.deleteMany({ documentId });
    await Embedding.deleteMany({ documentId });

    // 4) Merge text
    const fullText = textPerPage.join('\n');

    // 5) Chunk
    const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "800", 10);
    const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "200", 10);

    const chunks = splitIntoChunks(fullText, CHUNK_SIZE, CHUNK_OVERLAP);
    if (!chunks.length) throw new Error("Chunking produced 0 chunks");

    // 6) Embeddings
    const embeddings = await generateEmbeddings(chunks);
    if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) {
        throw new Error(
            `Embedding mismatch. Expected=${chunks.length}, got=${embeddings.length}`
        );
    }

    // 7) Save chunks + embeddings
    const operationsChunks = [];
    const operationsEmbeddings = [];

    for (let i = 0; i < chunks.length; i++) {
        const pageNo = Math.floor((i * (pages || 1)) / chunks.length) + 1;

        operationsChunks.push({
            insertOne: {
                documentId,
                chunkIndex: i,
                text: chunks[i],
                pageNo
            }
        });
    }

    // Insert chunks in bulk
    const chunkDocs = await Chunk.insertMany(
        operationsChunks.map(c => c.insertOne),
        { ordered: false }
    );

    // Build embedding docs in bulk
    for (let i = 0; i < chunks.length; i++) {
        const chunkDoc = chunkDocs[i];
        const pageNo = Math.floor((i * (pages || 1)) / chunks.length) + 1;

        operationsEmbeddings.push({
            documentId,
            chunkId: chunkDoc._id,
            embedding: embeddings[i],
            pageNo
        });
    }

    await Embedding.insertMany(operationsEmbeddings, { ordered: false });

    // 8) Vector store upsert (if service available)
    if (typeof upsertVectorStore === 'function') {
        try {
            const payload = operationsEmbeddings.map((emb, i) => ({
                documentId,
                chunkId: chunkDocs[i]._id,
                embedding: emb.embedding,
                metadata: { pageNo: emb.pageNo, chunkIndex: i }
            }));
            await upsertVectorStore(payload);
        } catch (err) {
            console.warn("vectorStore.upsertEmbeddings failed:", err.message || err);
        }
    }

    // 9) Mark ready
    await Document.findByIdAndUpdate(documentId, {
        status: 'ready',
        pages: pages || textPerPage.length,
        errorMessage: null
    });

    return { success: true };
}

// ==============================
// POST /api/worker/callback
// ==============================
router.post('/callback', async (req, res) => {
    try {
        const { documentId, pages, textPerPage } = req.body || {};

        if (!documentId || !Array.isArray(textPerPage)) {
            return res.status(400).json({
                success: false,
                message: "documentId and textPerPage[] are required."
            });
        }

        const result = await processOCRCallback(documentId, pages, textPerPage);

        return res.status(200).json({
            success: true,
            ...result,
            message: "OCR callback processed successfully."
        });

    } catch (error) {
        console.error("Worker callback error:", error.message || error);

        return res.status(500).json({
            success: false,
            message: "Failed to process OCR callback.",
            error: error.message
        });
    }
});

module.exports = router;
