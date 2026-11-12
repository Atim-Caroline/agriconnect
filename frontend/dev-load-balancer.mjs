import http from "node:http";

const port = Number(process.env.LB_PORT || 8080);
const backends = (process.env.AGRI_BACKENDS || "127.0.0.1:8001,127.0.0.1:8002")
  .split(",")
  .map((address) => {
    const [host, rawPort] = address.trim().split(":");
    const backendPort = Number(rawPort);
    if (!host || !Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
      throw new Error(`Invalid backend address: ${address}`);
    }
    return { host, port: backendPort };
  });

if (backends.length === 0) {
  throw new Error("Configure at least one backend in AGRI_BACKENDS.");
}

const healthCheckInterval = 1_000;
const healthCheckTimeout = 20_000;
let cachedStatuses = [];
let lastHealthCheck = 0;
let healthCheckPromise;
const bodyLimit = 32 * 1024 * 1024;
const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function isBackendAvailable({ host, port: backendPort }) {
  return new Promise((resolve) => {
    const request = http.get({
      host,
      port: backendPort,
      path: "/api/v1/health/",
      timeout: healthCheckTimeout,
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    const timer = setTimeout(() => request.destroy(), healthCheckTimeout);
    request.once("close", () => clearTimeout(timer));
    request.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function getBackendStatuses(force = false) {
  if (!force && Date.now() - lastHealthCheck < healthCheckInterval) {
    return cachedStatuses;
  }
  if (healthCheckPromise) return healthCheckPromise;

  healthCheckPromise = Promise.all(backends.map(async (backend, index) => ({
    address: `${backend.host}:${backend.port}`,
    role: index === 0 ? "primary" : "standby",
    available: await isBackendAvailable(backend),
    backend,
  }))).then((statuses) => {
    cachedStatuses = statuses;
    lastHealthCheck = Date.now();
    return statuses;
  }).finally(() => {
    healthCheckPromise = undefined;
  });

  return healthCheckPromise;
}

function sendUnavailable(res) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ detail: "All AgriConnect backend nodes are unavailable." }));
}

function forwardRequest(backend, req, res, body) {
  return new Promise((resolve) => {
    const headers = { ...req.headers, host: `${backend.host}:${backend.port}` };
    for (const header of hopByHopHeaders) delete headers[header];

    const forwardedFor = req.headers["x-forwarded-for"];
    headers["x-forwarded-for"] = [
      ...(Array.isArray(forwardedFor) ? forwardedFor : forwardedFor ? [forwardedFor] : []),
      req.socket.remoteAddress || "",
    ].filter(Boolean).join(", ");

    const upstream = http.request({
      host: backend.host,
      port: backend.port,
      method: req.method,
      path: req.url,
      headers,
      timeout: 60_000,
    }, (upstreamRes) => {
      const responseHeaders = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined && !hopByHopHeaders.has(name.toLowerCase())) {
          responseHeaders[name] = value;
        }
      }
      responseHeaders["x-agriconnect-upstream"] = `${backend.host}:${backend.port}`;
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      upstreamRes.pipe(res);
      upstreamRes.once("end", () => resolve({ retryable: false }));
      upstreamRes.once("aborted", () => {
        res.destroy();
        resolve({ retryable: false });
      });
      upstreamRes.once("error", () => {
        res.destroy();
        resolve({ retryable: false });
      });
    });

    let connected = false;
    upstream.once("socket", (socket) => {
      if (socket.connecting) socket.once("connect", () => { connected = true; });
      else connected = true;
    });
    upstream.once("timeout", () => {
      upstream.destroy(new Error("Backend request timed out."));
    });
    upstream.once("error", (error) => {
      if (!connected && !res.headersSent) {
        resolve({ retryable: true, error });
      } else if (!res.headersSent) {
        res.writeHead(error.message === "Backend request timed out." ? 504 : 502, {
          "content-type": "application/json; charset=utf-8",
          "x-agriconnect-upstream": `${backend.host}:${backend.port}`,
        });
        res.end(JSON.stringify({ detail: error.message }));
        resolve({ retryable: false });
      } else {
        res.destroy(error);
      }
    });
    upstream.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/__lb/health") {
    const statuses = await getBackendStatuses(true);
    const available = statuses.some((backend) => backend.available);
    res.writeHead(available ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      status: available ? "ok" : "unavailable",
      backends: statuses.map(({ backend, ...status }) => status),
    }));
    return;
  }

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > bodyLimit) {
        res.writeHead(413, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ detail: "Request body exceeds the 32 MiB development limit." }));
        return;
      }
      chunks.push(chunk);
    }
  } catch {
    if (!res.headersSent) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ detail: "Could not read the request body." }));
    }
    return;
  }

  const body = Buffer.concat(chunks);
  const statuses = await getBackendStatuses();
  const readyBackends = statuses.filter(({ available }) => available).map(({ backend }) => backend);
  if (readyBackends.length === 0) {
    sendUnavailable(res);
    return;
  }

  let lastError;

  for (const backend of readyBackends) {
    const result = await forwardRequest(backend, req, res, body);
    if (!result.retryable) return;
    lastError = result.error;
  }

  if (lastError) console.warn(`No backend accepted ${req.method} ${req.url}: ${lastError.message}`);
  sendUnavailable(res);
});

server.on("error", (error) => {
  console.error(`Load balancer could not listen on 127.0.0.1:${port}: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AgriConnect load balancer listening on http://127.0.0.1:${port}`);
  console.log(`Backends: ${backends.map(({ host, port: backendPort }) => `${host}:${backendPort}`).join(", ")}`);
});
