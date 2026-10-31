import type { RequestHandler, Response } from "express";
const clients = new Set<Response>();
const message = () =>
  `data: ${JSON.stringify({ success: true, data: { type: "inventory.changed" }, error: null })}\n\n`;
export function notifyInventoryChanged() {
  for (const client of clients) {
    if (client.destroyed) {
      clients.delete(client);
      continue;
    }
    if (!client.write(message())) client.end();
  }
}
export const inventoryStream: RequestHandler = (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  clients.add(res);
  res.write(message());
  const heartbeat = setInterval(() => {
    if (!res.write(": heartbeat\n\n")) res.end();
  }, 15000);
  const expiry = setTimeout(() => res.end(), 60000);
  res.on("close", () => {
    clients.delete(res);
    clearInterval(heartbeat);
    clearTimeout(expiry);
  });
};
