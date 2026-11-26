import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import request from "supertest";
import jwt from "jsonwebtoken";

test(
  "Importes por dueño, rebajas y conservación en entregas y cambios",
  { timeout: 120000 },
  async (t) => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:55450/postgres";
    process.env.JWT_SECRET = "owner-discounts-tests-only-secret-123456789";
    process.env.NODE_ENV = "test";
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
      port: 55450,
      host: "127.0.0.1",
      maxConnections: 10,
    });
    await socket.start();
    const { app } = await import("../src/app.js");
    const { prisma } = await import("../src/services/prisma.service.js");
    const { lineAmount } =
      await import("../src/services/salePricing.service.js");
    const { printableSales, boliviaDay } =
      await import("../src/services/ventas.service.js");
    const { salesPdf } = await import("../src/services/salesPdf.service.js");
    try {
      const user = await prisma.user.create({
        data: {
          name: "Test",
          email: "discount@test.local",
          passwordHash: "test",
        },
      });
      const ana = await prisma.propietario.create({ data: { nombre: "Ana" } });
      const dylan = await prisma.propietario.create({
        data: { nombre: "Dylan" },
      });
      const variants: number[] = [];
      for (const [price, owner] of [
        [100, ana.id_propietario],
        [80, ana.id_propietario],
        [120, dylan.id_propietario],
        [100, dylan.id_propietario],
      ]) {
        const dress = await prisma.vestido.create({
          data: {
            nombre: `Vestido ${price}`,
            descripcion: "Test",
            id_propietario: owner,
            precio_unitario: String(price),
            variantes: { create: { color: "Verde", cantidad_stock: 200 } },
          },
          include: { variantes: true },
        });
        variants.push(dress.variantes[0].id_variante);
      }
      const [a, b, c, d] = variants;
      const auth = {
        Authorization: `Bearer ${jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), issuer: "dap-api", audience: "dap-web", expiresIn: "1h" })}`,
      };
      const input = () => ({
        clave_registro: randomUUID(),
        hora_entrega_desde: "14:00",
        hora_entrega_hasta: null,
        cliente: { celular: "70000001", nombre: "Test" },
        detalles: [{ id_variante: a, cantidad: 3 }],
        adicional_delivery: "5",
        departamento_destino: "La_Paz",
        forma_pago: "Pagado",
        costo_envio: "20",
      });
      const post = (body: unknown) =>
        request(app).post("/api/ventas").set(auth).send(body);
      const fresh = (id: number) =>
        prisma.venta.findUniqueOrThrow({
          where: { id_venta: id },
          include: { detalles: true },
        });
      const stock = async () =>
        (
          await prisma.varianteVestido.findMany({
            orderBy: { id_variante: "asc" },
          })
        ).map((v) => v.cantidad_stock);
      const confirm = (sale: any, amount?: number) =>
        request(app)
          .post(`/api/ventas/${sale.id_venta}/entrega`)
          .set(auth)
          .send({
            version: sale.version,
            entregas: sale.detalles
              .filter((line: any) => line.tipo === "Entrega")
              .map((line: any) => ({
                id_detalle: line.id_detalle,
                cantidad: amount ?? line.cantidad,
              })),
          });

      await t.test(
        "desglosa dos dueños y aplica solo la rebaja indicada sin tocar envío ni delivery",
        async () => {
          const data = {
            ...input(),
            detalles: [
              { id_variante: a, cantidad: 2 },
              { id_variante: b, cantidad: 1 },
              { id_variante: c, cantidad: 1 },
            ],
            importes_propietario: [
              { id_propietario: ana.id_propietario, monto_prendas: "250" },
              { id_propietario: dylan.id_propietario, monto_prendas: "110" },
            ],
          };
          const r = await post(data);
          assert.equal(r.status, 201, JSON.stringify(r.body));
          const row = await fresh(r.body.data.id_venta);
          assert.equal(row.monto_vestidos.toString(), "360");
          assert.equal(row.total_cobrado.toString(), "385");
          assert.equal(row.monto_neto.toString(), "350");
          for (const [owner, amount] of [
            [ana.id_propietario, 250],
            [dylan.id_propietario, 110],
          ])
            assert.equal(
              row.detalles
                .filter((line) => line.id_propietario_venta === owner)
                .reduce(
                  (sum, line) => sum + Number(lineAmount(line, line.cantidad)),
                  0,
                ),
              amount,
            );
          const before = await stock();
          assert.equal((await post(data)).body.data.id_venta, row.id_venta);
          assert.deepEqual(await stock(), before);
          const done = await confirm(r.body.data);
          assert.equal(done.status, 200);
          assert.equal(done.body.data.total_cobrado, "385");
        },
      );

      await t.test(
        "centavos exactos al entregar parcialmente, devolver y conservar prendas rebajadas",
        async () => {
          const r = await post({
            ...input(),
            importes_propietario: [
              { id_propietario: ana.id_propietario, monto_prendas: "100" },
            ],
          });
          assert.equal(r.status, 201);
          const sale = r.body.data;
          assert.equal(sale.monto_vestidos, "100");
          assert.equal(sale.detalles[0].descuento_manual, "200");
          const done = await confirm(sale, 2);
          assert.equal(done.status, 200);
          assert.equal(done.body.data.monto_vestidos, "66.67");
          assert.equal(done.body.data.total_cobrado, "91.67");
          assert.equal((await confirm(sale, 2)).status, 200);
          const printable = await printableSales(boliviaDay(), [sale.id_venta]);
          assert.equal(
            lineAmount(printable[0].detalles[0], 2).toString(),
            "66.67",
          );
          assert.equal(
            (await salesPdf(printable)).subarray(0, 4).toString(),
            "%PDF",
          );
          const exchange = await request(app)
            .post(`/api/ventas/${sale.id_venta}/cambios`)
            .set(auth)
            .send({
              clave_registro: randomUUID(),
              version: done.body.data.version,
              hora_entrega_desde: "16:00",
              hora_entrega_hasta: null,
              devoluciones: [
                { id_detalle: sale.detalles[0].id_detalle, cantidad: 1 },
              ],
              entregas: [{ id_variante: d, cantidad: 1 }],
            });
          assert.equal(exchange.status, 201, JSON.stringify(exchange.body));
          const replacement = exchange.body.data;
          assert.equal(replacement.monto_devolucion, "33.34");
          assert.equal(replacement.monto_vestidos, "133.33");
          assert.equal(replacement.total_cobrado, "158.33");
          assert.equal(
            replacement.detalles.find(
              (line: any) => line.tipo === "Entrega" && line.id_variante === a,
            ).descuento_manual,
            "66.67",
          );
          const delivered = await confirm(replacement);
          assert.equal(delivered.status, 200);
          assert.equal(delivered.body.data.total_cobrado, "158.33");
          assert.equal((await fresh(sale.id_venta)).estado, "Cancelada");
        },
      );

      await t.test(
        "editar conserva rebajas y dueño histórico; restablecer recupera la tarifa",
        async () => {
          const data = {
            ...input(),
            importes_propietario: [
              { id_propietario: ana.id_propietario, monto_prendas: "270" },
            ],
          };
          const r = await post(data);
          assert.equal(r.status, 201);
          const sale = r.body.data;
          const v = await prisma.varianteVestido.findUniqueOrThrow({
            where: { id_variante: a },
          });
          await prisma.vestido.update({
            where: { id_vestido: v.id_vestido },
            data: {
              id_propietario: dylan.id_propietario,
              precio_unitario: "150",
            },
          });
          const edit = await request(app)
            .put(`/api/ventas/${sale.id_venta}`)
            .set(auth)
            .send({ ...data, version: sale.version, adicional_delivery: "7" });
          assert.equal(edit.status, 200, JSON.stringify(edit.body));
          assert.equal(edit.body.data.monto_vestidos, "270");
          assert.equal(edit.body.data.total_cobrado, "297");
          assert.equal(
            edit.body.data.detalles[0].id_propietario_venta,
            ana.id_propietario,
          );
          const reset = await request(app)
            .put(`/api/ventas/${sale.id_venta}`)
            .set(auth)
            .send({
              ...data,
              version: edit.body.data.version,
              importes_propietario: [],
            });
          assert.equal(reset.status, 200);
          assert.equal(reset.body.data.monto_vestidos, "300");
          assert.equal(reset.body.data.detalles[0].descuento_manual, "0");
          await prisma.vestido.update({
            where: { id_vestido: v.id_vestido },
            data: {
              id_propietario: ana.id_propietario,
              precio_unitario: "100",
            },
          });
        },
      );

      await t.test(
        "rechaza rebajas inválidas sin modificar stock ni registrar ventas",
        async () => {
          const before = await stock(),
            count = await prisma.venta.count();
          for (const overrides of [
            [{ id_propietario: ana.id_propietario, monto_prendas: "301" }],
            [{ id_propietario: dylan.id_propietario, monto_prendas: "50" }],
            [{ id_propietario: ana.id_propietario, monto_prendas: "-1" }],
            [{ id_propietario: ana.id_propietario, monto_prendas: "1.001" }],
            [{ id_propietario: ana.id_propietario, monto_prendas: "99.50" }],
            [{ id_propietario: ana.id_propietario, monto_prendas: "100.00" }],
            [
              { id_propietario: ana.id_propietario, monto_prendas: "200" },
              { id_propietario: ana.id_propietario, monto_prendas: "250" },
            ],
          ])
            assert.equal(
              (await post({ ...input(), importes_propietario: overrides }))
                .status,
              400,
            );
          assert.deepEqual(await stock(), before);
          assert.equal(await prisma.venta.count(), count);
        },
      );

      await t.test(
        "rebaja completa y cancelación total no cobran prendas ni duplican stock",
        async () => {
          const before = await stock();
          const r = await post({
            ...input(),
            importes_propietario: [
              { id_propietario: ana.id_propietario, monto_prendas: "0" },
            ],
          });
          assert.equal(r.status, 201);
          assert.equal(r.body.data.total_cobrado, "25");
          const done = await confirm(r.body.data, 0);
          assert.equal(done.status, 200);
          assert.equal(done.body.data.total_cobrado, "0");
          assert.equal(done.body.data.estado, "Cancelada");
          assert.deepEqual(await stock(), before);
          assert.equal((await confirm(r.body.data, 0)).status, 200);
          assert.deepEqual(await stock(), before);
        },
      );
    } finally {
      await prisma.$disconnect();
      await socket.stop();
      await db.close();
    }
  },
);
