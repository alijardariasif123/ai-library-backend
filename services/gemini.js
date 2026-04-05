

const axios = require('axios');

/**
 * ================= BASIC CONFIG =================
 * IMPORTANT:
 * OpenRouter का सही API endpoint:
 * https://openrouter.ai/api/v1
 * (api.openrouter.ai ❌ DNS पर resolve नहीं होता)
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
 * ================= HELPERS =================
 */
function isNetworkErr(err) {
  return (
    err?.code === 'ENOTFOUND' ||
    err?.code === 'EAI_AGAIN' ||
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ETIMEDOUT'
  );
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

/**
 * ================= CHAT CALL =================
 */
async function callChatWithRetry({ model, messages, maxTokens, temperature }) {
  if (!OR_KEY) {
    return {
      ok: false,
      fallbackText: 'AI API key not configured.'
    };
  }

  let tokens = Math.min(maxTokens || DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS);

  while (tokens >= MIN_TOKENS) {
    try {
      const resp = await axios.post(
        `${OR_BASE}/chat/completions`,
        {
          model,
          messages,
          max_tokens: tokens,
          temperature
        },
        {
          headers: {
            Authorization: `Bearer ${OR_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      const text = normalizeLLMText(resp.data);
      if (!text || !text.trim()) {
        throw new Error('EMPTY_COMPLETION');
      }

      return { ok: true, text: text.trim() };

    } catch (err) {
      const status = err?.response?.status;

      // 🚫 DNS / network issue
      if (isNetworkErr(err)) {
        return {
          ok: false,
          fallbackText: 'AI service unreachable (network issue).'
        };
      }

      // ⛔ Rate limit
      if (status === 429) {
        return {
          ok: false,
          fallbackText: 'AI is busy right now. Please try again after a short delay.'
        };
      }

      // 💳 Credits / token issue
      if (
        status === 402 ||
        /credits|max_tokens|insufficient/i.test(
          JSON.stringify(err?.response?.data || '')
        )
      ) {
        const reduced = Math.floor(tokens * RETRY_REDUCE_FACTOR);
        if (reduced >= tokens) break;
        tokens = Math.max(reduced, MIN_TOKENS);
        continue;
      }

      return {
        ok: false,
        fallbackText: 'AI error occurred. Try a shorter question.'
      };
    }
  }

  return {
    ok: false,
    fallbackText: 'AI limits reached. Try again later.'
  };
}

/**
 * ================= PROMPT BUILDER =================
 */
function buildMessages({ context, question, mode }) {
  let system = 'Answer strictly from CONTEXT. Be concise.';

  const q = question.toLowerCase();

  if (['name','email','phone','objective','address','dob'].some(k => q.includes(k))) {
    system =
      'You are a strict extractor. Return ONLY the exact value asked. ' +
      'If not found, return exactly: Not found';
  } else if (/translate/i.test(q)) {
    system = 'Translate the requested text using CONTEXT only. Return only translation.';
  } else if (mode === 'summary') {
    system = 'Summarize CONTEXT in 5–7 short sentences.';
  } else if (mode === 'topics') {
    system = 'List important topics from CONTEXT as bullet points.';
  } else if (mode === 'mcq') {
    system = 'Create 5 MCQs from CONTEXT with correct answer marked.';
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
 * ================= PUBLIC: generateCompletion =================
 */
async function generateCompletion({ question, context, mode, maxTokens, temperature }) {
  const messages = buildMessages({
    context: context || '',
    question: question || '',
    mode: mode || 'qa'
  });

  const result = await callChatWithRetry({
    model: DEFAULT_CHAT_MODEL,
    messages,
    maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
    temperature: typeof temperature === 'number' ? temperature : 0.2
  });

  if (result.ok) {
    return result.text;
  }

  return result.fallbackText || 'AI unavailable.';
}

/**
 * ================= PUBLIC: generateEmbeddings =================
 * Stable local fallback (so processing never fails)
 */
async function generateEmbeddings(texts) {
  const inputs = Array.isArray(texts) ? texts : [String(texts || '')];

  // No API key → local deterministic vectors
  if (!OR_KEY) {
    return inputs.map(t => {
      const s = String(t);
      return new Array(32).fill(0).map((_, i) => {
        const idx = (i * 7) % (s.length || 1);
        return ((s.charCodeAt(idx) || 13) % 100) / 100;
      });
    });
  }

  try {
    const resp = await axios.post(
      `${OR_BASE}/embeddings`,
      { model: DEFAULT_EMBED_MODEL, input: inputs },
      {
        headers: {
          Authorization: `Bearer ${OR_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    if (Array.isArray(resp.data?.data)) {
      return resp.data.data.map(d => d.embedding || []);
    }
  } catch (err) {
    console.warn('Embedding fallback used:', err.message);
  }

  // Final fallback
  return inputs.map(() => new Array(32).fill(0));
}

module.exports = {
  generateCompletion,
  generateEmbeddings
};
