import { httpRouter } from "convex/server";

import { auth } from "./auth";
import { renderPreview } from "./browserPreview";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
    path: "/api/preview/render",
    method: "POST",
    handler: renderPreview,
});

export default http;
