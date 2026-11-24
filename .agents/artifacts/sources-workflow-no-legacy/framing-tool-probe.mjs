import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';

const base = '.agents/artifacts/sources-workflow-no-legacy/framing-tool-probe';
mkdirSync(base, { recursive: true });
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const save = (name, value) => writeFileSync(`${base}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
const wire = json('.agents/artifacts/activity-excerpt-diagnosis/initial-wire.json');
const captured = json('.agents/artifacts/activity-excerpt-diagnosis/rejected-inputs.json')[1];
const original = captured.content.scope;
const initialContent = { scope: original, questions: [{ id: 'bypass', shortLabel: 'Insurer bypass', text: 'Which estimate-review dependencies constrain insurer bypass of CCC?', rationale: 'Identify control points without assuming bypass is possible.' }] };
const skill = readFileSync('agent-skills/workbench-framing/SKILL.md', 'utf8');
const system = `You are Workbench, preparing an analyst's research program before Start research. Use only the supplied state and observations. Save the requested proposal with the available framing tool. Do not start research or invent public facts. The analyst's activity and explicit edits remain authoritative. An unresolved event uses an open basis. For a new open scope, activityExcerpt must quote the analyst's words verbatim and occur in content.scope. The harness owns revision and message identifiers.\n\n${skill}`;
const cases = [
    { id: 'initial', initial: true, message: `Analyst: ${original}\nCurrent framing: empty scope, no questions. No public event has been established. Prepare and save a useful provisional program now, preserving the activity and keeping event-specific assumptions open.`, current: null },
    { id: 'repair', initial: true, message: `Analyst: ${original}\nCurrent framing remains empty. The preceding attempt was refused. Correct the indicated missing field in that proposal and submit the corrected write.`, current: null, rejected: { content: captured.content, eventBasis: captured.eventBasis } },
    { id: 'update', initial: false, message: `Active analyst message: Keep the existing scope exactly. Add one question about switching costs; retain the existing question unchanged.\nCurrent saved framing: ${JSON.stringify({ content: initialContent, eventBasis: { kind: 'open', activityExcerpt: original } })}\nNo public event has been established. Save the requested revision now.`, current: { content: initialContent, eventBasis: { kind: 'open', activityExcerpt: original } } },
];
const baseTool = wire.tools.find((t) => t.function.name === 'adjust_framing');
const requests = [];
for (let repeat = 1; repeat <= 2; repeat++) for (const c of cases) for (const arm of (repeat === 1 ? ['single', 'split'] : ['split', 'single'])) {
    const tool = structuredClone(baseTool);
    const name = arm === 'single' ? 'adjust_framing' : c.initial ? 'create_framing' : 'revise_framing';
    tool.function.name = name;
    tool.function.description = `${c.initial ? 'Create the initial' : 'Revise the existing'} proposed activity and research questions before Start research. Preserve explicit analyst adjustments. The harness binds the observed revision; stale edits are refused.`;
    const open = tool.function.parameters.properties.eventBasis.anyOf.find((s) => s.properties.kind.const === 'open');
    open.properties.activityExcerpt.description = 'A verbatim excerpt of the analyst activity or request, also present in content.scope. This is separate from condition-basis excerpts.';
    if (c.initial) {
        open.required = [...new Set([...open.required, 'activityExcerpt'])];
        tool.function.parameters.required = [...new Set([...tool.function.parameters.required, 'eventBasis'])];
    }
    const messages = [{ role: 'system', content: system }, { role: 'user', content: c.message }];
    if (c.rejected) messages.push(
        { role: 'assistant', content: null, tool_calls: [{ id: 'retained_refusal', type: 'function', function: { name, arguments: JSON.stringify(c.rejected) } }] },
        { role: 'tool', tool_call_id: 'retained_refusal', content: JSON.stringify({ kind: 'refused', code: 'framing_event_basis_invalid', validation: { path: 'eventBasis.activityExcerpt', expected: "Copy a nonblank excerpt of the analyst's activity or open request verbatim from the active message and include it in content.scope." }, diagnostic: 'Supply a valid eventBasis: none for ordinary framing, open for an unresolved event, an exact analyst excerpt, or a public label with readIds from adopted passages.' }) },
    );
    const body = { model: 'z-ai/glm-5.3-flash', provider: { only: ['wafer'], allow_fallbacks: false, require_parameters: true }, reasoning: { effort: 'high', enabled: true, exclude: true }, temperature: 0, max_completion_tokens: 8192, stream: false, tools: [tool], tool_choice: 'auto', messages, usage: { include: true } };
    requests.push({ id: `${c.id}-${arm}-${repeat}`, caseId: c.id, arm, repeat, original, current: c.current, body });
}
const upperBoundUsd = requests.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r.body)) * 0.065 / 1e6 + 8192 * 0.24 / 1e6, 0);
if (requests.length !== 12 || upperBoundUsd > 0.25) throw new Error('probe_envelope_exceeded');
const protocol = { boundary: 'isolated next native tool-call choice; no application execution or adaptive mission', model: 'z-ai/glm-5.3-flash', effort: 'high', provider: 'Wafer', calls: 12, maxCostUsd: 0.25, conservativeReservationUsd: upperBoundUsd, maxCompletionTokens: 8192, perRequestTimeoutMs: 90000, retries: 0, cases: cases.map(({ id, initial }) => ({ id, initial })), comparison: 'Only tool name differs between paired requests; lifecycle availability and equivalent input schemas remain matched. Other tools are not offered. This measures naming/interface response, not runtime integration.', criteria: ['exact offered tool selected once', 'arguments satisfy offered structure and real business write validation', 'initial and repair include a valid open activity anchor', 'update preserves scope and prior question while adding the requested question', 'no unsupported success without a tool call'], stop: '12 attempts or first unknown transport/charge outcome; no additional repeats', requestDigest: createHash('sha256').update(JSON.stringify(requests)).digest('hex') };
if (process.argv[2] === 'prepare') {
    save('protocol', protocol); save('requests', requests);
    console.log(JSON.stringify({ prepared: requests.length, conservativeReservationUsd: upperBoundUsd }));
} else if (process.argv[2] === 'run') {
    if (json(`${base}/protocol.json`).requestDigest !== protocol.requestDigest) throw new Error('prepared_request_changed');
    if (existsSync(`${base}/started.json`)) throw new Error('probe_already_started_no_blind_replay');
    const env = parseEnv(readFileSync('.env.local', 'utf8'));
    const key = process.env.OPENROUTER_API_KEY ?? env.OPENROUTER_API_KEY;
    if (!key) throw new Error('configuration_unavailable');
    save('started', { at: new Date().toISOString(), requestDigest: protocol.requestDigest });
    const start = Date.now();
    const results = [];
    let stop = false;
    for (let offset = 0; offset < requests.length && !stop; offset += 4) {
        const wave = await Promise.all(requests.slice(offset, offset + 4).map(async (request) => {
            const began = Date.now();
            const record = { id: request.id, startedAt: new Date().toISOString() };
            save(`attempt-${request.id}`, record);
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Workbench isolated framing tool design probe' }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(90000) });
                const text = await response.text();
                let body;
                try { body = JSON.parse(text); } catch { body = { unparsedBody: text }; }
                const result = { ...record, elapsedMs: Date.now() - began, status: response.status, body };
                save(`result-${request.id}`, result);
                return result;
            } catch (error) {
                const result = { ...record, elapsedMs: Date.now() - began, unknownDispatch: true, error: error instanceof Error ? error.message : String(error) };
                save(`result-${request.id}`, result);
                return result;
            }
        }));
        results.push(...wave);
        stop = wave.some((r) => r.unknownDispatch || r.status !== 200 || !Number.isFinite(r.body?.usage?.cost));
        console.log(JSON.stringify({ completed: results.length, stopped: stop, knownCostUsd: results.reduce((s, r) => s + (r.body?.usage?.cost ?? 0), 0) }));
    }
    save('completion', { elapsedMs: Date.now() - start, stopped: stop, attempted: results.length, unrun: requests.length - results.length, results: results.map((r) => ({ id: r.id, elapsedMs: r.elapsedMs, status: r.status, generationId: r.body?.id, provider: r.body?.provider, usage: r.body?.usage, finishReason: r.body?.choices?.[0]?.finish_reason, unknownDispatch: r.unknownDispatch })) });
} else throw new Error('Use prepare or run');
