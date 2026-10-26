import { createServer } from "node:http";

import { renderGreeting } from "./greeting.js";

const port = Number(process.env.PORT ?? 3000);

createServer((request, response) => {
  const visitorName = new URL(request.url ?? "/", `http://localhost:${port}`).searchParams.get("name") ?? "";
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>\n<title>tiny-web-app</title>\n${renderGreeting(visitorName)}\n`);
}).listen(port, () => console.log(`tiny-web-app ready on http://localhost:${port}`));
