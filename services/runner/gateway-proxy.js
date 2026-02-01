const http = require("http");

const GATEWAY = process.env.GATEWAY_TARGET || "gateway:80";
const API_KEY = process.env.OPENAI_API_KEY || "";
const PORT = parseInt(process.env.PROXY_PORT || "4101", 10);

// Timeout matching LiteLLM router_settings.timeout (300s) + 30s buffer
const PROXY_TIMEOUT_MS = 330 * 1000;

const server = http.createServer((clientReq, clientRes) => {
  // Build proxy options: inject auth header, forward everything else
  const opts = {
    hostname: GATEWAY.split(":")[0],
    port: parseInt(GATEWAY.split(":")[1] || "80", 10),
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, authorization: `Bearer ${API_KEY}` },
    timeout: PROXY_TIMEOUT_MS,
  };
  delete opts.headers.host;

  const proxy = http.request(opts, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  proxy.on("timeout", () => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(504, { "Content-Type": "text/plain" });
      clientRes.end("Gateway timeout: upstream did not respond in time");
    }
    proxy.destroy();
  });

  proxy.on("error", (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "text/plain" });
      clientRes.end(`Proxy error: ${err.message}`);
    }
  });

  // Handle client disconnect (abort) — only destroy upstream if the
  // response hasn't been fully sent yet.  The "close" event on the
  // response stream fires when the underlying socket closes.  If the
  // response hasn't finished writing, the client disconnected early.
  clientRes.on("close", () => {
    if (!clientRes.writableFinished && !proxy.destroyed) {
      proxy.destroy();
    }
  });

  clientReq.pipe(proxy, { end: true });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Gateway auth proxy listening on 127.0.0.1:${PORT} -> ${GATEWAY}`);
  console.log("Mode: streaming passthrough (injects auth, proxies all requests transparently)");
  console.log(`Timeout: ${PROXY_TIMEOUT_MS / 1000}s`);
});
