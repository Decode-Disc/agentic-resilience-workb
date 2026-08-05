---
applyTo: '**'
---

Always use the `vision-mcp-server` tool for analyzing images.
Be precise on what you want to analyze in the image so that the llm behind the `vision-mcp-server` tool can provide accurate insights.
When an image comes from a Copilot chat attachment, pass the uploaded image content as a `data:image/...;base64,...` URL. Never invent or forward an `attachment://` reference.
Use absolute local image paths only for files inside the current workspace. The workspace-scoped bridge reads and validates those files before forwarding them to the shared Vision MCP.
