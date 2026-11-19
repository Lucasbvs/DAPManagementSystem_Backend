import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

process.env.DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55451/postgres";
process.env.JWT_SECRET = "daily-close-tests-only-secret-123456789";
process.env.NODE_ENV = "test";
const { closeExpiredPendingSales, nextSalesCloseCheck, startDailySalesClose } =
  await import("../src/services/dailySalesClose.service.js");
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("programación: arranque, medianoche de Bolivia, reintento y parada", async (t) => {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: new Date("2026-11-20T03:59:59.990Z"),
  });
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const stop = startDailySalesClose(async () => {
    calls++;
    if (calls === 2) throw new Error("DB temporalmente desconectada");
    return 0;
  });
  try {
    await flush();
    assert.equal(calls, 1);
    assert.equal(nextSalesCloseCheck(), 10);
    t.mock.timers.tick(9);
    await flush();
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(calls, 2);
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(calls, 3);
    await stop();
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(calls, 3);
  } finally {
    await stop();
    t.mock.timers.reset();
  }
});

test(
  "cierre automático recupera pendientes sin alterar stock, rebajas ni importes",
  { timeout: 120000 },
  async (t) => {
    const db = await PGlite.create();
    for (const dir of (
      await readdir("prisma/migrations", { withFileTypes: true })
    )
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await db.exec(
        await readFile(`prisma/migrations/${dir.name}/migration.sql`, "utf8"),
      );
    const socket = new PGLiteSocketServer({
      db,
      port: 55451,
      host: "127.0.0.1",
      maxConnections: 10,
    });
    await socket.start();
    const { prisma } = await import("../src/services/prisma.service.js");
    const { saveSale, confirmDelivery, cancelSale, exchangeSale } =
      await import("../src/services/ventas.service.js");
    try {
      const owner = await prisma.propietario.create({
        data: { nombre: "Ana" },
      });
      const dress = await prisma.vestido.create({
        data: {
          nombre: "Aurora",
          descripcion: "Test",
          id_propietario: owner.id_propietario,
          precio_unitario: "100",
          variantes: {
            create: [
              { color: "Verde", cantidad_stock: 100 },
              { color: "Rojo", cantidad_stock: 100 },
            ],
          },
        },
        include: { variantes: true },
      });
      const [variant, newVariant] = dress.variantes;
      const create = () =>
        saveSale({
          clave_registro: randomUUID(),
          hora_entrega_desde: "14:00",
          hora_entrega_hasta: null,
          cliente: {
            celular: "70000001",
            nombre: "Test",
            direccion_entrega: null,
            link_ubicacion: null,
          },
          detalles: [{ id_variante: variant.id_variante, cantidad: 3 }],
          importes_propietario: [
            { id_propietario: owner.id_propietario, monto_prendas: "270" },
          ],
          adicional_delivery: "5",
          departamento_destino: "La_Paz",
          ciudad_provincia: null,
          forma_pago: "Pagado",
          costo_envio: "20",
        });
      const fresh = (id: number) =>
        prisma.venta.findUniqueOrThrow({
          where: { id_venta: id },
          include: { detalles: { orderBy: { id_detalle: "asc" } } },
        });
      const stock = async () =>
        (
          await prisma.varianteVestido.findMany({
            orderBy: { id_variante: "asc" },
          })
        ).map((v) => v.cantidad_stock);
      const markDate = (id: number, iso: string) =>
        prisma.venta.update({
          where: { id_venta: id },
          data: { fecha: new Date(iso) },
        });
      await t.test(
        "cierra el día a las 00:00 de Bolivia y recupera días atrasados una sola vez",
        async () => {
          const old = await create(),
            late = await create(),
            today = await create(),
            tomorrow = await create(),
            done = await create(),
            cancelled = await create();
          await confirmDelivery(done.id_venta, {
            version: done.version,
            entregas: [
              { id_detalle: done.detalles[0].id_detalle, cantidad: 1 },
            ],
          });
          await cancelSale(cancelled.id_venta, cancelled.version);
          await markDate(old.id_venta, "2026-11-18T12:00:00Z");
          await markDate(late.id_venta, "2026-11-20T03:59:59.999Z");
          await markDate(today.id_venta, "2026-11-20T04:00:00.000Z");
          await markDate(tomorrow.id_venta, "2026-11-21T04:00:00Z");
          await markDate(done.id_venta, "2026-11-19T12:00:00Z");
          await markDate(cancelled.id_venta, "2026-11-19T12:00:00Z");
          const beforeStock = await stock(),
            beforeLate = await fresh(late.id_venta),
            beforeDone = await fresh(done.id_venta),
            beforeCancelled = await fresh(cancelled.id_venta);
          assert.equal(
            await closeExpiredPendingSales(
              new Date("2026-11-20T03:59:59.999Z"),
            ),
            1,
          );
          assert.equal((await fresh(late.id_venta)).estado, "Pendiente");
          assert.equal(
            await closeExpiredPendingSales(new Date("2026-11-20T04:00:00Z")),
            1,
          );
          const afterLate = await fresh(late.id_venta);
          assert.deepEqual(afterLate, {
            ...beforeLate,
            estado: "Realizada",
            version: beforeLate.version + 1,
          });
          assert.equal(afterLate.total_cobrado.toString(), "295");
          assert.equal(afterLate.monto_neto.toString(), "260");
          assert.equal((await fresh(today.id_venta)).estado, "Pendiente");
          assert.equal((await fresh(tomorrow.id_venta)).estado, "Pendiente");
          assert.deepEqual(await fresh(done.id_venta), beforeDone);
          assert.deepEqual(await fresh(cancelled.id_venta), beforeCancelled);
          assert.deepEqual(await stock(), beforeStock);
          assert.equal(
            await closeExpiredPendingSales(new Date("2026-11-20T04:00:00Z")),
            0,
          );
          assert.equal((await fresh(late.id_venta)).version, afterLate.version);
          // Una entrega completa repetida desde una pantalla antigua es idempotente; una parcial se rechaza.
          assert.equal(
            (
              await confirmDelivery(late.id_venta, {
                version: beforeLate.version,
                entregas: [
                  { id_detalle: late.detalles[0].id_detalle, cantidad: 3 },
                ],
              })
            ).estado,
            "Realizada",
          );
          await assert.rejects(
            () =>
              confirmDelivery(late.id_venta, {
                version: beforeLate.version,
                entregas: [
                  { id_detalle: late.detalles[0].id_detalle, cantidad: 1 },
                ],
              }),
            { code: "SALE_CHANGED" },
          );
          assert.deepEqual(await stock(), beforeStock);
          // Recuperación después de varios días apagado.
          assert.equal(
            await closeExpiredPendingSales(new Date("2026-11-24T04:00:00Z")),
            2,
          );
        },
      );
      await t.test(
        "un cambio pendiente se entrega completo sin revivir la venta original",
        async () => {
          const original = await create();
          const delivered = await confirmDelivery(original.id_venta, {
            version: original.version,
            entregas: [
              { id_detalle: original.detalles[0].id_detalle, cantidad: 3 },
            ],
          });
          const replacement = await exchangeSale(original.id_venta, {
            clave_registro: randomUUID(),
            version: delivered.version,
            hora_entrega_desde: "15:00",
            hora_entrega_hasta: null,
            devoluciones: [
              { id_detalle: original.detalles[0].id_detalle, cantidad: 1 },
            ],
            entregas: [{ id_variante: newVariant.id_variante, cantidad: 1 }],
          });
          await markDate(replacement.id_venta, "2026-11-19T12:00:00Z");
          const before = await fresh(replacement.id_venta),
            beforeStock = await stock();
          assert.equal(
            await closeExpiredPendingSales(new Date("2026-11-20T04:00:00Z")),
            1,
          );
          assert.deepEqual(await fresh(replacement.id_venta), {
            ...before,
            estado: "Realizada",
            version: before.version + 1,
          });
          assert.equal((await fresh(original.id_venta)).estado, "Cancelada");
          assert.deepEqual(await stock(), beforeStock);
        },
      );
      await t.test(
        "dos procesos de cierre concurrentes solo confirman una vez",
        async () => {
          const sale = await create();
          await markDate(sale.id_venta, "2026-11-19T12:00:00Z");
          const before = await stock();
          const counts = await Promise.all([
            closeExpiredPendingSales(new Date("2026-11-20T04:00:00Z")),
            closeExpiredPendingSales(new Date("2026-11-20T04:00:00Z")),
          ]);
          assert.equal(
            counts.reduce((a, b) => a + b, 0),
            1,
          );
          assert.equal((await fresh(sale.id_venta)).version, sale.version + 1);
          assert.deepEqual(await stock(), before);
        },
      );
      await t.test(
        "confirmación parcial simultánea con el cierre no duplica stock ni pisa la entrega",
        async () => {
          const sale = await create();
          await markDate(sale.id_venta, "2026-11-19T12:00:00Z");
          const before = await stock();
          const results = await Promise.allSettled([
            confirmDelivery(sale.id_venta, {
              version: sale.version,
              entregas: [
                { id_detalle: sale.detalles[0].id_detalle, cantidad: 1 },
              ],
            }),
            closeExpiredPendingSales(new Date("2026-11-20T04:00:00Z")),
          ]);
          assert.equal(results[1].status, "fulfilled");
          const row = await fresh(sale.id_venta),
            after = await stock();
          assert.equal(row.estado, "Realizada");
          assert.equal(row.version, sale.version + 1);
          if (results[0].status === "fulfilled") {
            assert.equal(row.detalles[0].cantidad_cancelada, 2);
            assert.equal(after[0], before[0] + 2);
          } else {
            assert.equal(results[0].reason.code, "SALE_CHANGED");
            assert.equal(row.detalles[0].cantidad_cancelada, 0);
            assert.deepEqual(after, before);
          }
        },
      );
    } finally {
      await prisma.$disconnect();
      await socket.stop();
      await db.close();
    }
  },
);
