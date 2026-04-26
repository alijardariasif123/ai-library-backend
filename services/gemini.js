const axios = require('axios');

/**
 * ================= CONFIG =================
 */
const OR_BASE = (process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const OR_KEY = process.env.OPENROUTER_API_KEY || null;

const DEFAULT_CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL ||
  process.env.OPENROUTER_MODEL ||
  'openai/gpt-4o-mini';

const DEFAULT_EMBED_MODEL =
  process.env.OPENROUTER_EMBED_MODEL ||
  'openai/text-embedding-3-small';

const DEFAULT_MAX_TOKENS = parseInt(process.env.OPENROUTER_MAX_TOKENS || '512', 10);
const MIN_TOKENS = 64;
const RETRY_REDUCE_FACTOR = 0.5;

/**
 * 🔥 EMBEDDING CONTROL
 */
const EMBED_BATCH_SIZE = parseInt(process.env.EMBED_BATCH_SIZE || '3', 10);
const EMBED_RETRY_LIMIT = parseInt(process.env.EMBED_RETRY_LIMIT || '3', 10);
const EMBED_DELAY_MS = parseInt(process.env.EMBED_DELAY_MS || '2500', 10);
const EMBED_429_WAIT_MS = parseInt(process.env.EMBED_429_WAIT_MS || '15000', 10);

/**
 * ================= AXIOS INSTANCE =================
 */
const http = axios.create({
  timeout: 60000,
  headers: {
    Authorization: OR_KEY ? `Bearer ${OR_KEY}` : '',
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://your-app.local',
    'X-Title': 'AI-OCR-App'
  }
});

/**
 * ================= HELPERS =================
 */
function isNetworkErr(err) {
  return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT'].includes(err?.code);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeLLMText(data) {
  return (
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    data?.output ||
    data?.result ||
    ''
  );
}

function createZeroVector(size = 32) {
  return new Array(size).fill(0);
}

/**
 * ================= CHAT =================
 */
async function callChatWithRetry({ model, messages, maxTokens, temperature }) {
  if (!OR_KEY) {
    return { ok: false, fallbackText: 'AI API key not configured.' };
  }

  let tokens = Math.min(maxTokens || DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await http.post(`${OR_BASE}/chat/completions`, {
        model,
        messages,
        max_tokens: tokens,
        temperature
      });

      const text = normalizeLLMText(resp.data);

      if (!text?.trim()) throw new Error('EMPTY');

      return { ok: true, text: text.trim() };

    } catch (err) {
      const status = err?.response?.status;

      console.warn('AI error:', status, err.message);

      if (isNetworkErr(err)) {
        await sleep(2000);
        continue;
      }

      if (status === 429) {
        await sleep(8000);
        continue;
      }

      if (
        status === 402 ||
        /credits|max_tokens/i.test(JSON.stringify(err?.response?.data || ''))
      ) {
        tokens = Math.max(Math.floor(tokens * RETRY_REDUCE_FACTOR), MIN_TOKENS);
        continue;
      }

      return { ok: false, fallbackText: 'AI error occurred.' };
    }
  }

  return { ok: false, fallbackText: 'AI unavailable.' };
}

/**
 * ================= PROMPT =================
 */
function buildMessages({ context, question, mode }) {
  let system = 'Answer strictly from CONTEXT.';

  const q = question.toLowerCase();

  if (/name|email|phone|objective|address|dob/.test(q)) {
    system = 'Extract exact value only. If not found return: Not found';
  } else if (/translate/.test(q)) {
    system = 'Translate using context only.';
  } else if (mode === 'summary') {
    system = 'Summarize in 5–7 sentences.';
  } else if (mode === 'mcq') {
    system = 'Create 5 MCQs with answers.';
  }

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `CONTEXT:\n${context || 'N/A'}\n\nQUESTION:\n${question}`
    }
  ];
}

/**
 * ================= PUBLIC =================
 */
async function generateCompletion({ question, context, mode, maxTokens, temperature }) {
  const messages = buildMessages({ context, question, mode });

  const result = await callChatWithRetry({
    model: DEFAULT_CHAT_MODEL,
    messages,
    maxTokens,
    temperature: temperature ?? 0.2
  });

  return result.ok ? result.text : result.fallbackText;
}

/**
 * ================= EMBEDDINGS (429 SAFE) =================
 */
async function generateEmbeddings(texts) {
  const inputs = Array.isArray(texts) ? texts : [String(texts)];

  if (!inputs.length) return [];

  if (!OR_KEY) {
    return inputs.map(t =>
      new Array(32).fill(0).map((_, i) => ((t.charCodeAt(i % t.length) || 7) % 100) / 100)
    );
  }

  const finalVectors = [];

  for (let i = 0; i < inputs.length; i += EMBED_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBED_BATCH_SIZE);

    let success = false;

    for (let attempt = 1; attempt <= EMBED_RETRY_LIMIT; attempt++) {
      try {
        const resp = await http.post(`${OR_BASE}/embeddings`, {
          model: DEFAULT_EMBED_MODEL,
          input: batch
        });

        if (!Array.isArray(resp.data?.data)) {
          throw new Error('Invalid embedding response');
        }

        finalVectors.push(
          ...resp.data.data.map(item => item.embedding || createZeroVector())
        );

        success = true;
        break;

      } catch (err) {
        const status = err?.response?.status;

        console.warn(
          `Embedding error | batch ${i / EMBED_BATCH_SIZE + 1} | try ${attempt} | status ${status || 'NA'}`
        );

        if (status === 429 && attempt < EMBED_RETRY_LIMIT) {
          await sleep(EMBED_429_WAIT_MS * attempt);
          continue;
        }

        if (isNetworkErr(err) && attempt < EMBED_RETRY_LIMIT) {
          await sleep(5000);
          continue;
        }

        break;
      }
    }

    if (!success) {
      finalVectors.push(...batch.map(() => createZeroVector()));
    }

    await sleep(EMBED_DELAY_MS);
  }

  return finalVectors;
}

module.exports = {
  generateCompletion,
  generateEmbeddings
};