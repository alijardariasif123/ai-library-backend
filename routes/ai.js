const express = require("express");
const router = express.Router();

const Conversation = require("../models/Conversation");
const Document = require("../models/Document");
const Chunk = require("../models/Chunk");

const { generateCompletion } = require("../services/gemini");
const { authMiddleware } = require("../middleware/auth");

router.use(authMiddleware);

// optional vector store
let vectorStore = null;
try {
  vectorStore = require("../services/vectorStore");
} catch {
  console.warn("vectorStore not found — DB fallback enabled");
}


/* ================= CONFIG ================= */
const BASE_MAX_CHUNKS = parseInt(process.env.AI_MAX_CHUNKS || "4", 10);
const TRIM_CHARS_PER_CHUNK = parseInt(process.env.AI_CHUNK_TRIM_CHARS || "600", 10);
const MAX_CONTEXT_CHARS = parseInt(process.env.AI_MAX_CONTEXT_CHARS || "3000", 10);
const MAX_MESSAGES_PER_CONV = parseInt(process.env.AI_MAX_MESSAGES || "200", 10);

/* ================= HELPERS ================= */
function buildContextFromChunks(chunks, maxChunks) {
  if (!chunks || !chunks.length) return "";

  const selected = chunks.slice(0, maxChunks).map(c => {
    const t = String(c.text || "");
    return t.length > TRIM_CHARS_PER_CHUNK
      ? t.slice(0, TRIM_CHARS_PER_CHUNK)
      : t;
  });

  let context = selected.join("\n\n---\n\n");
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS);
  }
  return context;
}

function inferChunkCount(question) {
  const q = question.toLowerCase();
  if (/complete|full|entire|pura|sab/i.test(q)) return BASE_MAX_CHUNKS * 3;
  if (/detail|explain|describe/i.test(q)) return BASE_MAX_CHUNKS * 2;
  return BASE_MAX_CHUNKS;
}

/* ================= ROUTE ================= */
router.post("/query", async (req, res) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { documentId, question, mode = "qa" } = req.body;

    if (!documentId || !question?.trim()) {
      return res.status(400).json({ error: "documentId and question required" });
    }

    /* 1️⃣ document */
    const doc = await Document.findById(documentId).lean();
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (doc.status !== "ready") {
      return res.status(400).json({ error: "Document not ready" });
    }

    /* 2️⃣ conversation */
    let conv = await Conversation.findOne({ userId: user._id, documentId });
    if (!conv) {
      conv = await Conversation.create({
        userId: user._id,
        documentId,
        messages: []
      });
    }

    if (conv.messages.length > MAX_MESSAGES_PER_CONV) {
      conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONV);
    }

    conv.messages.push({
      role: "user",
      text: question.trim(),
      meta: { mode }
    });
    await conv.save();

    /* 3️⃣ chunks */
    const maxChunks = inferChunkCount(question);
    let chunks = [];

    if (vectorStore?.semanticSearch) {
      try {
        chunks = await vectorStore.semanticSearch({
          documentId,
          query: question,
          topK: maxChunks
        });
      } catch (e) {
        console.warn("vector search failed:", e.message);
      }
    }

    if (!chunks.length) {
      chunks = await Chunk.find({ documentId })
        .sort({ chunkIndex: 1 })
        .limit(maxChunks)
        .lean();
    }

    const context = buildContextFromChunks(chunks, maxChunks);

    /* 4️⃣ AI */
    const answer = await generateCompletion({
      question,
      context,
      mode
    });

    const safeAnswer =
      answer && answer.trim()
        ? answer
        : "No relevant information found in document.";

    conv.messages.push({
      role: "assistant",
      text: safeAnswer,
      meta: { mode }
    });
    await conv.save();

    const sentence =
      safeAnswer.split(/\.\s+/).filter(Boolean)[0] || safeAnswer;

    return res.json({
      success: true,
      answer: safeAnswer,
      sentence,
      conversationId: conv._id,
      documentId,
      chunksUsed: chunks.length
    });

  } catch (err) {
    console.error("AI route error:", err);
    return res.status(500).json({
      error: "AI service error",
      details: err.message
    });
  }
});

module.exports = router;
