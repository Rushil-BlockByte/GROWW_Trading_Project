import { spawn } from "node:child_process";
import net from "node:net";

const listenHost = process.env.PG_PROXY_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.PG_PROXY_PORT ?? "5432");
const distro = process.env.WSL_DISTRO ?? "Ubuntu";
const targetHost = process.env.PG_PROXY_TARGET_HOST ?? "127.0.0.1";
const targetPort = process.env.PG_PROXY_TARGET_PORT ?? "5432";

function closeQuietly(handle) {
  if (!handle.destroyed) {
    handle.destroy();
  }
}

const server = net.createServer((socket) => {
  const bridge = spawn(
    "wsl",
    ["-d", distro, "--", "nc", targetHost, targetPort],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  socket.pipe(bridge.stdin);
  bridge.stdout.pipe(socket);

  bridge.stderr.on("data", (chunk) => {
    process.stderr.write(`[wsl-postgres-proxy] ${chunk}`);
  });

  bridge.on("error", () => closeQuietly(socket));
  bridge.on("exit", () => closeQuietly(socket));
  socket.on("error", () => bridge.kill());
  socket.on("close", () => bridge.kill());
});

server.on("error", (error) => {
  process.stderr.write(`[wsl-postgres-proxy] ${error.message}\n`);
  process.exitCode = 1;
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(
    `WSL PostgreSQL proxy listening on ${listenHost}:${listenPort} -> ${distro}:${targetHost}:${targetPort}\n`,
  );
});
