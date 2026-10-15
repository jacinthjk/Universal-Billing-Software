// Claude provider: a manual agentic loop over the platform's controlled tools.
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../../config');

let client;
const getClient = () => {
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
};

const MAX_TOOL_ROUNDS = 8;

async function createMessage(params) {
  try {
    // Server-side fallback reroutes a safety-classifier refusal to another model automatically.
    return await getClient().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
      return getClient().messages.create(params);
    }
    throw e;
  }
}

/**
 * Runs one customer turn. `messages` is the full API history (append-only, so thinking blocks stay valid);
 * returns the reply text and the updated history.
 */
async function run({ system, messages, tools, executeTool, model, effort }) {
  const history = [...messages];
  let uncertain = false;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    let response;
    try {
      response = await createMessage({
        model,
        max_tokens: 16000,
        system,
        tools,
        messages: history,
        output_config: { effort },
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return { text: 'We are getting a lot of messages right now - please try again in a moment.', messages, uncertain: true, failed: true };
      if (e instanceof Anthropic.APIError) {
        console.error('[ai] Claude API error', e.status, e.message);
        return { text: null, messages, uncertain: true, failed: true };
      }
      throw e;
    }

    history.push({ role: 'assistant', content: response.content });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

    if (response.stop_reason === 'refusal') {
      return { text: null, messages: history, uncertain: true, refused: true };
    }
    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason !== 'tool_use') {
      return { text: text || null, messages: history, uncertain };
    }

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const results = await Promise.all(toolUses.map(async (tu) => {
      const { ok, output } = await executeTool(tu.name, tu.input);
      if (!ok) uncertain = uncertain || tu.name !== 'get_order_status';
      return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(output), ...(ok ? {} : { is_error: true }) };
    }));
    // All results for one assistant turn go back in a single user message.
    history.push({ role: 'user', content: results });
  }
  return { text: null, messages: history, uncertain: true };
}

module.exports = { name: 'anthropic', run };
