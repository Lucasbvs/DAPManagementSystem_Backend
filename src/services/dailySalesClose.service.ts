import { prisma } from "./prisma.service.js";
import { boliviaDay, dayRange } from "./ventas.service.js";
import { notifyInventoryChanged } from "./inventoryEvents.service.js";

/** Entrega completa: el stock y los importes ya se reservaron al registrar la venta. */
export async function closeExpiredPendingSales(now = new Date()) {
  const day = boliviaDay(now);
  const result = await prisma.venta.updateMany({
    where: { estado: "Pendiente", fecha: { lt: dayRange(day).gte } },
    data: { estado: "Realizada", version: { increment: 1 } },
  });
  if (result.count) {
    notifyInventoryChanged();
    if (process.env.NODE_ENV !== "test")
      console.info("[ventas] Cierre automático del día", {
        anteriores_a: day,
        entregadas: result.count,
      });
  }
  return result.count;
}

export function nextSalesCloseCheck(now = new Date()) {
  const midnight = dayRange(boliviaDay(now)).lt.getTime();
  return Math.max(1, Math.min(60_000, midnight - now.getTime()));
}

/** Arranca recuperando días pendientes; comprueba cada minuto y a medianoche. */
export function startDailySalesClose(
  close: () => Promise<number> = closeExpiredPendingSales,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  function tick() {
    if (stopped) return;
    inFlight = Promise.resolve()
      .then(close)
      .then(
        () => {},
        (error) => {
          console.error(
            "[ventas] No se pudo completar el cierre automático; se reintentará",
            error,
          );
        },
      )
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, nextSalesCloseCheck());
          timer.unref();
        }
      });
  }
  tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}
