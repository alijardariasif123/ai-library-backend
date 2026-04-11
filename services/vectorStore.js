const Embedding = require('../models/Embedding');
const Chunk = require('../models/Chunk');

/**
 * Calculate cosine similarity between two numeric vectors
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = Number(a[i]) || 0;
    const bi = Number(b[i]) || 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Upsert embeddings.
 *
 * Supports two calling styles:
 * 1) (documentId, chunkIds[], vectors[], pageNos[])
 * 2) single array payload: [{ documentId, chunkId, embedding, pageNo }]
 *
 * Returns summary: { upsertedCount, modifiedCount }
 */
async function upsertEmbeddings(arg1, arg2, arg3, arg4) {
  try {
    let bulkOps = [];

    if (Array.isArray(arg1) && arg2 === undefined) {
      // style 2: payload array
      const payload = arg1;
      for (const item of payload) {
        if (!item || !item.documentId || !item.chunkId || !Array.isArray(item.embedding)) continue;
        bulkOps.push({
          updateOne: {
            filter: { documentId: item.documentId, chunkId: item.chunkId },
            update: { $set: { embedding: item.embedding, pageNo: item.pageNo || 1 } },
            upsert: true
          }
        });
      }
    } else {
      // style 1: (documentId, chunkIds, vectors, pageNos)
      const documentId = arg1;
      const chunkIds = Array.isArray(arg2) ? arg2 : [];
      const vectors = Array.isArray(arg3) ? arg3 : [];
      const pageNos = Array.isArray(arg4) ? arg4 : [];

      const n = Math.min(chunkIds.length, vectors.length);
      for (let i = 0; i < n; i++) {
        if (!chunkIds[i] || !Array.isArray(vectors[i])) continue;
        bulkOps.push({
          updateOne: {
            filter: { documentId, chunkId: chunkIds[i] },
            update: { $set: { embedding: vectors[i], pageNo: pageNos[i] || 1 } },
            upsert: true
          }
        });
      }
    }

    if (bulkOps.length === 0) {
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    // execute unordered bulk for best performance
    const res = await Embedding.bulkWrite(bulkOps, { ordered: false });

    // Compute a simple summary (bulkWrite results can vary by mongoose/mongo driver)
    const upsertedCount = res.upsertedCount || (res.upsertedIds ? Object.keys(res.upsertedIds).length : 0);
    const modifiedCount = res.modifiedCount || res.nModified || 0;

    return { upsertedCount, modifiedCount };
  } catch (err) {
    console.error('vectorStore.upsertEmbeddings error:', err && err.stack ? err.stack : err);
    throw err;
  }
}

/**
 * Maintain a top-K min-replacement structure (simple array implementation)
 * items: [{ id, score, pageNo }]
 * @param {Array} heap current topK array sorted by score ascending
 * @param {Object} item candidate {chunkId, score, pageNo}
 * @param {number} k
 */
function pushTopK(heap, item, k) {
  if (heap.length < k) {
    heap.push(item);
    // keep ascending (smallest first)
    heap.sort((a, b) => a.score - b.score);
    return;
  }
  // heap[0] is smallest
  if (item.score <= heap[0].score) return;
  // replace smallest
  heap[0] = item;
  heap.sort((a, b) => a.score - b.score);
}

/**
 * Query most similar chunks for a document using cosine similarity.
 * This is memory-safe for large collections because it streams embeddings via a cursor.
 *
 * @param {string|ObjectId} documentId
 * @param {number[]} queryEmbedding
 * @param {number} topK
 * @returns {Promise<Array<{ text, pageNo, score, chunkId }>>}
 */
async function querySimilarChunks(documentId, queryEmbedding, topK = 5) {
  if (!documentId) throw new Error('documentId is required');
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new Error('queryEmbedding must be a non-empty array');
  }
  topK = Math.max(1, parseInt(topK || '5', 10));

  // Optional path: if using MongoDB Atlas Vector Search, you can enable it via env var
  if (process.env.USE_VECTOR_SEARCH === 'true') {
    // NOTE: This block is a placeholder — Atlas Vector Search queries differ by setup.
    // If you have Atlas Vector Search configured, implement a $search stage here.
    // For backward compatibility we fall-through to cursor-based search.
    console.warn('USE_VECTOR_SEARCH is true but no implementation provided. Falling back to cursor scan.');
  }

  // Stream through embeddings and keep topK
  const cursor = Embedding.find({ documentId })
    .hint({ documentId: 1 }) // 🔥 performance boost
    .lean()
    .cursor();

  const top = []; // ascending by score (smallest first)
  const qVec = queryEmbedding;

  for await (const emb of cursor) {
    if (!emb || !Array.isArray(emb.embedding)) continue;

    if (emb.embedding.length !== qVec.length) {
      console.warn('Embedding length mismatch skipped');
      continue;
    }

    const score = cosineSimilarity(qVec, emb.embedding);
    pushTopK(top, { chunkId: emb.chunkId, pageNo: emb.pageNo, score }, topK);
  }

  if (top.length === 0) return [];

  // top currently ascending (smallest first); we want descending
  top.sort((a, b) => b.score - a.score);
  const chunkIds = top.map((t) => t.chunkId);

  // fetch chunk texts in one go (preserve ordering)
  const chunks = await Chunk.find({ _id: { $in: chunkIds } }).lean();

  // Map chunks by id for quick lookup
  const chunkMap = new Map();
  for (const c of chunks) chunkMap.set(String(c._id), c);

  const results = top.map((t) => {
    const cid = String(t.chunkId);
    const chunk = chunkMap.get(cid);
    return {
      chunkId: t.chunkId,
      text: chunk?.text || '',
      pageNo: t.pageNo,
      score: t.score
    };
  });

  return results;
}

module.exports = {
  upsertEmbeddings,
  querySimilarChunks,
  cosineSimilarity
};
