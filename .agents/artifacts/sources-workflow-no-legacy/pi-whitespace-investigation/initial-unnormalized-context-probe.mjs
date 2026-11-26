import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { stream as piStream } from '@earendil-works/pi-ai/api/openai-completions';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, Output, tool, jsonSchema } from 'ai';

// Entire process is offline. An accidental un-injected HTTP call fails closed.
globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const model = { id: 'offline/model', name: 'Offline replay', provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 16384 };
const hash = value => createHash('sha256').update(value).digest('hex');
const summarize = text => ({ length: text.length, sha256: hash(text), trailingWhitespace: text.length - text.trimEnd().length });
const fixtures = [
  { name: 'valid', deltas: ['{"ok":', 'true}'], finish: true },
  { name: 'complete-whitespace', deltas: ['{"ok":true}', ' '.repeat(8192), '\n\t'.repeat(4096)], finish: true },
  { name: 'prefix-whitespace', deltas: ['{"ok":', ' '.repeat(8192), '\n\t'.repeat(4096)], finish: true },
  { name: 'complete-eof', deltas: ['{"ok":true}'], finish: false },
  { name: 'prefix-eof', deltas: ['{"ok":', ' '.repeat(8192)], finish: false },
  { name: 'prefix-cancel', deltas: ['{"ok":', ' '.repeat(8192)], finish: false, cancel: true },
];
const retainedPath = '/home/abdwhb/.cache/workbench-evaluations/framing-fidelity-method-v3-20261121/shared-material-prepared/lots/lot-1/observations/before-cleanup-8facecc3-e50c-4911-967d-c96630c144b0/nvidia-sources-capture-handoff/invocations-9.json';
const retained = JSON.parse(readFileSync(retainedPath, 'utf8')).page[0].visibleOutputText;
// Real retained bytes; synthetic chunk boundaries and synthetic terminal finish.
fixtures.push({ name: 'retained-9-synthetic-finish', deltas: [retained.slice(0, 11000), retained.slice(11000)], finish: true, retainedPath });
const records = [];
for (const fixture of fixtures) for (const channel of ['text', 'tool']) {
  const frames = fixture.deltas.map((delta, index) => ({ id: 'gen-offline', object: 'chat.completion.chunk', created: 1, model: model.id, choices: [{ index: 0, delta: channel === 'text' ? { content: delta } : { tool_calls: [{ index: 0, ...(index === 0 ? { id: 'call_offline', type: 'function' } : {}), function: { ...(index === 0 ? { name: 'submit' } : {}), arguments: delta } }] }, finish_reason: null }] }));
  if (fixture.finish) frames.push({ id: 'gen-offline', object: 'chat.completion.chunk', created: 1, model: model.id, choices: [{ index: 0, delta: {}, finish_reason: channel === 'text' ? 'stop' : 'tool_calls' }] });
  const wire = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + (fixture.cancel ? '' : 'data: [DONE]\n\n');
  for (const sdk of ['pi', 'ai', 'ai-adapter']) {
    const abort = new AbortController();
    let request, calls = 0;
    const fakeFetch = async (_url, init) => {
      calls++;
      request = JSON.parse(init.body);
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(wire));
          if (fixture.cancel) {
            // Mechanical fixture deadline, not a suggested application policy.
            const timer = setTimeout(() => abort.abort(new DOMException('Offline fixture cancellation', 'AbortError')), 40);
            abort.signal.addEventListener('abort', () => { clearTimeout(timer); controller.error(abort.signal.reason); }, { once: true });
          } else controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    let received = '', outcome, events = [];
    if (sdk === 'pi') {
      const stream = piStream(model, { messages: [{ role: 'user', content: 'Return ok true.', timestamp: 1 }], ...(channel === 'tool' ? { tools: [{ name: 'submit', description: 'Submit result', parameters: schema }] } : {}) }, { apiKey: 'offline-not-a-secret', fetch: fakeFetch, signal: abort.signal, maxRetries: 0, maxTokens: 16384 });
      for await (const event of stream) {
        events.push(event.type);
        if (event.type === 'text_delta' || event.type === 'toolcall_delta') received += event.delta;
      }
      const result = await stream.result();
      outcome = { stopReason: result.stopReason, errorMessage: result.errorMessage, content: result.content.map(block => block.type === 'text' ? { type: block.type, text: summarize(block.text) } : { ...block, ...(block.argumentsError ? { argumentsError: { ...summarize(block.argumentsError), preview: block.argumentsError.slice(0, 100) } } : {}) }) };
    } else if (sdk === 'ai-adapter') {
      const provider = createOpenRouter({ apiKey: 'offline-not-a-secret', fetch: fakeFetch });
      const result = await provider.chat(model.id).doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return ok true.' }] }], abortSignal: abort.signal, ...(channel === 'text' ? { responseFormat: { type: 'json', schema } } : { tools: [{ type: 'function', name: 'submit', description: 'Submit result', inputSchema: schema }] }) });
      outcome = {};
      try {
        for await (const event of result.stream) {
          events.push(event.type);
          if (event.type === 'text-delta') received += event.delta;
          if (event.type === 'tool-input-delta') received += event.delta;
          if (event.type === 'finish') outcome.finishReason = event.finishReason;
          if (event.type === 'tool-call') outcome.toolCall = { ...event, input: summarize(event.input) };
        }
      } catch (error) { outcome.error = { name: error.name, message: error.message }; }
    } else {
      const provider = createOpenRouter({ apiKey: 'offline-not-a-secret', fetch: fakeFetch });
      const stream = streamText({ model: provider.chat(model.id), prompt: 'Return ok true.', maxRetries: 0, maxOutputTokens: 16384, abortSignal: abort.signal, ...(channel === 'text' ? { output: Output.object({ schema: jsonSchema(schema) }) } : { tools: { submit: tool({ description: 'Submit result', inputSchema: jsonSchema(schema) }) } }), onError() {} });
      // Consume promises immediately to prevent expected parse/cancellation rejections becoming unhandled.
      const promises = [stream.text, stream.finishReason, stream.toolCalls, ...(channel === 'text' ? [stream.output] : [])].map(p => Promise.resolve(p).then(value => ({ ok: true, value }), error => ({ ok: false, error: error.message, name: error.name })));
      for await (const event of stream.fullStream) {
        events.push(event.type);
        if (event.type === 'text-delta') received += event.text;
        if (event.type === 'tool-input-delta') received += event.delta;
      }
      const [text, finish, toolCalls, output] = await Promise.all(promises);
      outcome = { text: text.ok ? summarize(text.value) : text, finish, toolCalls, output };
    }
    assert.equal(calls, 1);
    if (!fixture.cancel || sdk !== 'ai' || channel !== 'text') assert.equal(hash(received), hash(fixture.deltas.join('')));
    records.push({ fixture: fixture.name, channel, sdk, input: summarize(fixture.deltas.join('')), wire: summarize(wire), received: summarize(received), calls, request, events, outcome });
  }
}
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ versions: { piAI: '1.4.0', ai: '7.0.138', openrouter: '3.1.0' }, fixtureDefinitions: fixtures.map(f => ({ ...f, deltas: f.deltas.map(summarize) })), records }, null, 2));
for (const r of records) console.log(JSON.stringify({ fixture: r.fixture, channel: r.channel, sdk: r.sdk, received: r.received, calls: r.calls, outcome: r.outcome }));
