/** Synthetic OpenAI Responses stream: inspect evidence, then return the supplied review. */
export function qualificationReviewResponse(reviewJson: string, turn: number) {
    const tool = turn === 1;
    const item = tool
        ? {
              id: "fc-fixture",
              type: "function_call",
              call_id: "call-fixture",
              name: "read",
              arguments: JSON.stringify({ path: "published.json" }),
              status: "completed",
          }
        : {
              id: "msg-fixture",
              type: "message",
              role: "assistant",
              content: [
                  { type: "output_text", text: reviewJson, annotations: [] },
              ],
              status: "completed",
          };
    const events = [
        { type: "response.created", response: { id: `response-${turn}` } },
        {
            type: "response.output_item.added",
            output_index: 0,
            item: tool ? { ...item, arguments: "" } : { ...item, content: [] },
        },
        ...(tool
            ? [
                  {
                      type: "response.function_call_arguments.delta",
                      output_index: 0,
                      delta: item.arguments,
                  },
              ]
            : [
                  {
                      type: "response.output_text.delta",
                      output_index: 0,
                      delta: reviewJson,
                  },
              ]),
        { type: "response.output_item.done", output_index: 0, item },
        {
            type: "response.completed",
            response: {
                id: `response-${turn}`,
                status: "completed",
                output: [item],
                usage: {
                    input_tokens: 100,
                    output_tokens: 100,
                    input_tokens_details: { cached_tokens: 0 },
                },
            },
        },
    ];
    return new Response(
        events
            .map(
                (event) =>
                    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join(""),
        { headers: { "content-type": "text/event-stream" } },
    );
}
