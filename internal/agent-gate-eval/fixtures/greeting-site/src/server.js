import { createServer } from "node:http";

import { contactRoutes } from "./contact.js";
import { homeRoutes } from "./home.js";

const port = Number(process.env.PORT ?? 3000);

createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  const pagesByRoute = { ...homeRoutes(url), ...contactRoutes };
  const renderPage = pagesByRoute[`${request.method} ${url.pathname}`];
  if (!renderPage) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(renderPage());
}).listen(port);
