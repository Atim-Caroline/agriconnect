import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const loadBalancerPath = fileURLToPath(new URL("../dev-load-balancer.mjs", import.meta.url));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function makeBackend(name) {
  let healthy = true;
  let healthDelay = 0;
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/health/") {
      const respond = () => {
        if (!healthy) return;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      };
      if (healthDelay) setTimeout(respond, healthDelay);
      else respond();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ node: name }));
  });

  return {
    server,
    setHealthy(value) {
      healthy = value;
    },
    setHealthDelay(value) {
      healthDelay = value;
    },
  };
}

async function getJson(url) {
  const response = await fetch(url);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("routes to a healthy node, fails over, and returns to the recovered primary", async () => {
  const primary = makeBackend("primary");
  const standby = makeBackend("standby");
  primary.setHealthDelay(300);
  const primaryPort = await listen(primary.server);
  const standbyPort = await listen(standby.server);
  const portReservation = createServer();
  const loadBalancerPort = await listen(portReservation);
  await close(portReservation);
  const loadBalancer = spawn(process.execPath, [loadBalancerPath], {
    env: {
      ...process.env,
      LB_PORT: String(loadBalancerPort),
      AGRI_HEALTH_CHECK_TIMEOUT_MS: "500",
      AGRI_BACKENDS: `127.0.0.1:${primaryPort},127.0.0.1:${standbyPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  loadBalancer.stdout.on("data", (chunk) => { output += chunk; });
  loadBalancer.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Load balancer did not start.")), 5_000);
      loadBalancer.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("load balancer listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
      loadBalancer.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      loadBalancer.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Load balancer exited with ${code}: ${output}`));
      });
    });

    const apiUrl = `http://127.0.0.1:${loadBalancerPort}/api/v1/test`;
    assert.equal((await getJson(apiUrl)).body.node, "primary");

    primary.setHealthy(false);
    const failoverStarted = Date.now();
    const health = await getJson(`http://127.0.0.1:${loadBalancerPort}/__lb/health`);
    assert.ok(Date.now() - failoverStarted < 5_000, "unresponsive-node detection should be bounded");
    assert.equal(health.status, 200);
    assert.equal(health.body.backends[0].available, false);
    assert.equal((await getJson(apiUrl)).body.node, "standby");

    primary.setHealthy(true);
    const recovered = await getJson(`http://127.0.0.1:${loadBalancerPort}/__lb/health`);
    assert.equal(recovered.body.backends[0].available, true);
    assert.equal((await getJson(apiUrl)).body.node, "primary");

    primary.setHealthy(false);
    standby.setHealthy(false);
    const unavailable = await getJson(`http://127.0.0.1:${loadBalancerPort}/__lb/health`);
    assert.equal(unavailable.status, 503);
    assert.equal((await getJson(apiUrl)).status, 503);
  } finally {
    if (loadBalancer.exitCode === null) {
      loadBalancer.kill();
      await once(loadBalancer, "exit");
    }
    await Promise.all([close(primary.server), close(standby.server)]);
  }
});
