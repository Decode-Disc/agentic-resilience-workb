import type { IncomingMessage, ServerResponse } from "node:http";

/** External Convex HTTP protocol used by local publisher fixtures, including its admission guard. */
export async function servePublicationGuard(
    request: IncomingMessage,
    response: ServerResponse,
    state: { held: boolean; activeWorkers?: boolean; unavailable?: boolean },
): Promise<boolean> {
    if (request.url !== "/api/query" && request.url !== "/api/mutation")
        return false;
    if (state.unavailable) {
        response.writeHead(503).end();
        return true;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    let value: unknown;
    if (payload.path === "execution/piControl:holdPublication") {
        state.held = payload.args[0].held;
        value = null;
    } else if (
        payload.path === "execution/piControl:recoverPublicationWorkers"
    ) {
        if (!state.held) throw new Error("publication_hold_required");
        state.activeWorkers = false;
        value = null;
    } else if (payload.path === "execution/piControl:publicationStatus") {
        value = {
            held: state.held,
            hasActiveWorkers: state.activeWorkers ?? false,
        };
    } else {
        response.writeHead(400).end();
        return true;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "success", value }));
    return true;
}
