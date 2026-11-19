import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import request from "supertest";
import jwt from "jsonwebtoken";

test(
  "Entregas pendientes y reemplazo completo de ventas",
  { timeout: 120000 },
  async (t) => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:55449/postgres";
    process.env.JWT_SECRET = "pending-sales-tests-only-secret-123456789";
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
      port: 55449,
      host: "127.0.0.1",
      maxConnections: 10,
    });
    await socket.start();
    const { app } = await import("../src/app.js");
    const { prisma } = await import("../src/services/prisma.service.js");
    try {
      const user = await prisma.user.create({
        data: {
          name: "Test",
          email: "delivery@test.local",
          passwordHash: "test",
        },
      });
      const owner = await prisma.propietario.create({
        data: { nombre: "Ana" },
      });
      const variants = [];
      for (const price of [100, 150]) {
        const dress = await prisma.vestido.create({
          data: {
            nombre: `Vestido ${price}`,
            descripcion: "Test",
            id_propietario: owner.id_propietario,
            precio_unitario: String(price),
            variantes: {
              create: { color: "Verde", talla: "M", cantidad_stock: 100 },
            },
          },
          include: { variantes: true },
        });
        variants.push(dress.variantes[0].id_variante);
      }
      const [a, b] = variants;
      const auth = {
        Authorization: `Bearer ${jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), issuer: "dap-api", audience: "dap-web", expiresIn: "1h" })}`,
      };
      const stock = async (id: number) =>
        (
          await prisma.varianteVestido.findUniqueOrThrow({
            where: { id_variante: id },
          })
        ).cantidad_stock;
      const fresh = async (id: number) =>
        prisma.venta.findUniqueOrThrow({
          where: { id_venta: id },
          include: { detalles: true },
        });
      const input = () => ({
        clave_registro: randomUUID(),
        hora_entrega_desde: "14:00",
        hora_entrega_hasta: null,
        cliente: { celular: "70000001", nombre: "Cliente" },
        detalles: [{ id_variante: a, cantidad: 3 }],
        adicional_delivery: "5",
        departamento_destino: null,
        costo_envio: null,
      });
      const create = async () => {
        const r = await request(app)
          .post("/api/ventas")
          .set(auth)
          .send(input());
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.data.estado, "Pendiente");
        return r.body.data;
      };
      const confirm = (sale: any, entregas: any[]) =>
        request(app)
          .post(`/api/ventas/${sale.id_venta}/entrega`)
          .set(auth)
          .send({ version: sale.version, entregas });
      await t.test(
        "forma de pago y envío opcional; ajuste por venta, repetición y validación",
        async () => {
          const make = async (payment: string, cost: string | null) => {
            const r = await request(app)
              .post("/api/ventas")
              .set(auth)
              .send({
                ...input(),
                forma_pago: payment,
                departamento_destino: "La_Paz",
                costo_envio: cost,
              });
            assert.equal(r.status, 201, JSON.stringify(r.body));
            return r.body.data;
          };
          const unpaid = await make("Por_pagar", null),
            paid = await make("Pagado", null),
            known = await make("Pagado", "12.50");
          assert.equal(unpaid.forma_pago, "Por_pagar");
          assert.equal(paid.costo_envio, null);
          assert.equal(known.costo_envio, "12.5");
          const bad = await request(app)
            .post("/api/ventas")
            .set(auth)
            .send({
              ...input(),
              forma_pago: "Por_pagar",
              departamento_destino: "La_Paz",
              costo_envio: "10",
            });
          assert.equal(bad.status, 400);
          const item = (sale: any, cost?: string) => ({
            id_venta: sale.id_venta,
            version: sale.version,
            ...(cost === undefined ? {} : { costo_envio: cost }),
            entregas: [
              { id_detalle: sale.detalles[0].id_detalle, cantidad: 1 },
            ],
          });
          const invalid = await request(app)
            .post("/api/ventas/entregas")
            .set(auth)
            .send({ ventas: [item(paid, "8"), item(unpaid, "5")] });
          assert.equal(invalid.status, 400);
          assert.equal((await fresh(paid.id_venta)).estado, "Pendiente");
          const ventas = [item(paid, "20.50"), item(known, "7"), item(unpaid)];
          const send = () =>
            request(app)
              .post("/api/ventas/entregas")
              .set(auth)
              .send({ ventas });
          const done = await send();
          assert.equal(done.status, 200, JSON.stringify(done.body));
          assert.equal(
            (await fresh(paid.id_venta)).total_cobrado.toString(),
            "125.5",
          );
          assert.equal(
            (await fresh(known.id_venta)).costo_envio?.toString(),
            "7",
          );
          assert.equal(
            (await fresh(paid.id_venta)).monto_neto.toString(),
            "90",
          );
          assert.equal((await send()).status, 200);
          assert.equal(
            (
              await request(app)
                .post("/api/ventas/entregas")
                .set(auth)
                .send({ ventas: [item(paid, "21")] })
            ).status,
            409,
          );
          const zero = await make("Pagado", null);
          assert.equal(
            (
              await request(app)
                .post(`/api/ventas/${zero.id_venta}/entrega`)
                .set(auth)
                .send({ ...item(zero, "0"), id_venta: undefined })
            ).status,
            200,
          );
          for (const cost of ["-1", "1.001", "100000000"]) {
            assert.equal(
              (
                await request(app)
                  .post("/api/ventas/entregas")
                  .set(auth)
                  .send({ ventas: [item(zero, cost)] })
              ).status,
              400,
            );
          }
        },
      );
      await t.test(
        "confirmación parcial preserva precio, resta totales y devuelve stock una sola vez",
        async () => {
          const before = await stock(a),
            sale = await create();
          assert.equal(await stock(a), before - 3);
          const lines = [
            { id_detalle: sale.detalles[0].id_detalle, cantidad: 1 },
          ];
          const r = await confirm(sale, lines);
          assert.equal(r.status, 200, JSON.stringify(r.body));
          assert.equal(r.body.data.estado, "Realizada");
          assert.equal(r.body.data.total_cobrado, "105");
          assert.equal(r.body.data.monto_neto, "90");
          assert.equal(r.body.data.detalles[0].cantidad_cancelada, 2);
          assert.equal(await stock(a), before - 1);
          assert.equal((await confirm(sale, lines)).status, 200);
          assert.equal(await stock(a), before - 1);
          const cancelled = await request(app)
            .post(`/api/ventas/${sale.id_venta}/cancelar`)
            .set(auth)
            .send({ version: r.body.data.version });
          assert.equal(cancelled.status, 200);
          assert.equal(await stock(a), before);
        },
      );
      await t.test(
        "sin prendas entregadas se cancela toda la venta",
        async () => {
          const before = await stock(a),
            sale = await create(),
            r = await confirm(sale, []);
          assert.equal(r.status, 200);
          assert.equal(r.body.data.estado, "Cancelada");
          assert.equal(r.body.data.total_cobrado, "0");
          assert.equal(await stock(a), before);
        },
      );
      await t.test(
        "rechaza cantidades ajenas, excesivas y versiones vencidas",
        async () => {
          const sale = await create(),
            before = await stock(a);
          assert.equal(
            (
              await confirm(sale, [
                { id_detalle: sale.detalles[0].id_detalle, cantidad: 4 },
              ])
            ).status,
            400,
          );
          assert.equal(
            (await confirm(sale, [{ id_detalle: 99999, cantidad: 1 }])).status,
            400,
          );
          assert.equal(
            (await confirm({ ...sale, version: 999 }, [])).status,
            409,
          );
          assert.equal(await stock(a), before);
        },
      );
      await t.test(
        "confirmaciones simultáneas incompatibles no duplican la devolución",
        async () => {
          const sale = await create(),
            before = await stock(a),
            id = sale.detalles[0].id_detalle;
          const results = await Promise.all([
            confirm(sale, [{ id_detalle: id, cantidad: 1 }]),
            confirm(sale, [{ id_detalle: id, cantidad: 2 }]),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
          const row = await fresh(sale.id_venta);
          assert.equal(await stock(a), before + 3 - row.total_prendas);
        },
      );
      await t.test(
        "cambio cancela original, conserva prendas y usa total completo; repetición idempotente",
        async () => {
          const sale = await create(),
            beforeA = await stock(a),
            beforeB = await stock(b);
          const delivered = await confirm(
            sale,
            sale.detalles.map((d: any) => ({
              id_detalle: d.id_detalle,
              cantidad: d.cantidad,
            })),
          );
          assert.equal(delivered.status, 200);
          sale.version = delivered.body.data.version;
          const body = {
            clave_registro: randomUUID(),
            version: sale.version,
            hora_entrega_desde: "15:00",
            hora_entrega_hasta: null,
            devoluciones: [
              { id_detalle: sale.detalles[0].id_detalle, cantidad: 1 },
            ],
            entregas: [{ id_variante: b, cantidad: 1 }],
          };
          const exchange = () =>
            request(app)
              .post(`/api/ventas/${sale.id_venta}/cambios`)
              .set(auth)
              .send(body);
          const r = await exchange();
          assert.equal(r.status, 201, JSON.stringify(r.body));
          const replacement = r.body.data;
          assert.equal((await fresh(sale.id_venta)).estado, "Cancelada");
          assert.equal(replacement.estado, "Pendiente");
          assert.equal(replacement.reemplazo_completo, true);
          assert.equal(replacement.total_prendas, 3);
          assert.equal(replacement.monto_vestidos, "350");
          assert.equal(replacement.total_cobrado, "355");
          assert.equal(replacement.monto_neto, "340");
          assert.equal(await stock(a), beforeA + 1);
          assert.equal(await stock(b), beforeB - 1);
          assert.equal(
            (await exchange()).body.data.id_venta,
            replacement.id_venta,
          );
          assert.equal(await stock(a), beforeA + 1);
          const cancelled = await request(app)
            .post(`/api/ventas/${replacement.id_venta}/cancelar`)
            .set(auth)
            .send({ version: replacement.version });
          assert.equal(cancelled.status, 200);
          assert.equal(await stock(a), beforeA + 3);
          assert.equal(await stock(b), beforeB);
        },
      );

      await t.test(
        "cambio de una venta pendiente se rechaza sin mover stock",
        async () => {
          const sale = await create(),
            beforeA = await stock(a),
            beforeB = await stock(b);
          const r = await request(app)
            .post(`/api/ventas/${sale.id_venta}/cambios`)
            .set(auth)
            .send({
              clave_registro: randomUUID(),
              version: sale.version,
              hora_entrega_desde: "15:00",
              hora_entrega_hasta: null,
              devoluciones: [
                { id_detalle: sale.detalles[0].id_detalle, cantidad: 1 },
              ],
              entregas: [{ id_variante: b, cantidad: 1 }],
            });
          assert.equal(r.status, 409);
          assert.equal(r.body.error.code, "SALE_NOT_DELIVERED");
          assert.equal(await stock(a), beforeA);
          assert.equal(await stock(b), beforeB);
        },
      );
      await t.test(
        "entregas múltiples se guardan juntas y pueden repetirse sin duplicar stock",
        async () => {
          const first = await create(),
            second = await create(),
            before = await stock(a);
          const ventas = [
            {
              id_venta: first.id_venta,
              version: first.version,
              entregas: [
                { id_detalle: first.detalles[0].id_detalle, cantidad: 1 },
              ],
            },
            {
              id_venta: second.id_venta,
              version: second.version,
              entregas: [],
            },
          ];
          const send = () =>
            request(app)
              .post("/api/ventas/entregas")
              .set(auth)
              .send({ ventas });
          const r = await send();
          assert.equal(r.status, 200, JSON.stringify(r.body));
          assert.equal((await fresh(first.id_venta)).estado, "Realizada");
          assert.equal((await fresh(second.id_venta)).estado, "Cancelada");
          assert.equal(await stock(a), before + 5);
          assert.equal((await send()).status, 200);
          assert.equal(await stock(a), before + 5);
        },
      );
      await t.test(
        "una venta inválida revierte todas las confirmaciones del lote",
        async () => {
          const first = await create(),
            second = await create(),
            before = await stock(a);
          const ventas = [
            { id_venta: first.id_venta, version: first.version, entregas: [] },
            { id_venta: second.id_venta, version: 999, entregas: [] },
          ];
          const r = await request(app)
            .post("/api/ventas/entregas")
            .set(auth)
            .send({ ventas });
          assert.equal(r.status, 409);
          assert.equal(await stock(a), before);
          assert.equal((await fresh(first.id_venta)).estado, "Pendiente");
          assert.equal(
            (await fresh(first.id_venta)).detalles[0].cantidad_cancelada,
            0,
          );
          assert.equal(
            (
              await request(app)
                .post("/api/ventas/entregas")
                .set(auth)
                .send({ ventas: [ventas[0], ventas[0]] })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "envío requiere nombre y validación rechaza espacios",
        async () => {
          const data = input();
          const r = await request(app)
            .post("/api/ventas")
            .set(auth)
            .send({
              ...data,
              cliente: { ...data.cliente, nombre: "  " },
              departamento_destino: "La_Paz",
              costo_envio: "10",
            });
          assert.equal(r.status, 400);
        },
      );
    } finally {
      await prisma.$disconnect();
      await socket.stop();
      await db.close();
    }
  },
);
