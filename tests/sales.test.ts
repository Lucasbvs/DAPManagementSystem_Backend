import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import request from "supertest";
import jwt from "jsonwebtoken";

test(
  "Ventas: precios, stock, historial, concurrencia y PDF",
  { timeout: 120000 },
  async (t) => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:55441/postgres";
    process.env.JWT_SECRET = "sales-test-secret-with-at-least-32-characters";
    process.env.NODE_ENV = "test";
    const db = await PGlite.create();
    for (const e of (
      await readdir("prisma/migrations", { withFileTypes: true })
    )
      .filter((x) => x.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await db.exec(
        await readFile(`prisma/migrations/${e.name}/migration.sql`, "utf8"),
      );
    const socket = new PGLiteSocketServer({
      db,
      port: 55441,
      host: "127.0.0.1",
      maxConnections: 10,
    });
    await socket.start();
    const { app } = await import("../src/app.js");
    const { prisma } = await import("../src/services/prisma.service.js");
    const { boliviaDay } = await import("../src/services/ventas.service.js");
    try {
      const user = await prisma.user.create({
        data: { email: "sales@test.local", name: "Test", passwordHash: "test" },
      });
      const owner = await prisma.propietario.create({
        data: { nombre: "Ana" },
      });
      const token = jwt.sign({}, process.env.JWT_SECRET, {
          subject: String(user.id),
          issuer: "dap-api",
          audience: "dap-web",
          expiresIn: "1h",
        }),
        auth = { Authorization: `Bearer ${token}` };
      const dress = await prisma.vestido.create({
        data: {
          nombre: "Aurora",
          descripcion: "Vestido",
          id_propietario: owner.id_propietario,
          precio_unitario: "100.10",
          precio_cuarta: "90.05",
          precio_media_docena: "80.01",
          variantes: {
            create: [
              { color: "Verde", talla: "M", cantidad_stock: 100 },
              { color: "Rosa", talla: "L", cantidad_stock: 100 },
            ],
          },
        },
        include: { variantes: true },
      });
      const basic = await prisma.vestido.create({
        data: {
          nombre: "Emma",
          descripcion: "Sin descuento",
          id_propietario: owner.id_propietario,
          precio_unitario: "50.55",
          variantes: { create: { color: "Negro", cantidad_stock: 100 } },
        },
        include: { variantes: true },
      });
      const v = dress.variantes[0].id_variante,
        v2 = dress.variantes[1].id_variante,
        b = basic.variantes[0].id_variante;
      const input = (n = 1, id = v) => ({
        hora_entrega_desde: "14:30",
        hora_entrega_hasta: null,
        clave_registro: randomUUID(),
        cliente: {
          celular: "70000001",
          nombre: "Cliente",
          direccion_entrega: "Av. Siempre Viva",
          link_ubicacion: "https://maps.google.com/",
        },
        detalles: [{ id_variante: id, cantidad: n }],
        adicional_delivery: "5.25",
        departamento_destino: null,
        ciudad_provincia: null,
        costo_envio: null,
      });
      const post = (body: unknown) =>
        request(app).post("/api/ventas").set(auth).send(body);
      let sale: any;
      await t.test(
        "autenticación, validación y sin stock: sin ventas parciales",
        async () => {
          assert.equal((await request(app).get("/api/ventas")).status, 401);
          for (const body of [
            { ...input(), detalles: [] },
            { ...input(), adicional_delivery: "-1" },
            { ...input(), detalles: [{ id_variante: v, cantidad: 0 }] },
            { ...input(), departamento_destino: "La_Paz" },
            { ...input(), cliente: { celular: "invalid" } },
            {
              ...input(),
              detalles: [
                { id_variante: v, cantidad: 1 },
                { id_variante: v, cantidad: 1 },
              ],
            },
          ])
            assert.equal((await post(body)).status, 400);
          assert.equal((await post(input(101))).status, 409);
          assert.equal(await prisma.venta.count(), 0);
          assert.equal(
            (
              await prisma.varianteVestido.findUniqueOrThrow({
                where: { id_variante: v },
              })
            ).cantidad_stock,
            100,
          );
        },
      );
      await t.test(
        "tramos 1/2/3/5/6 y descuento ausente: exactitud en centavos",
        async () => {
          for (const [n, price] of [
            [1, "100.1"],
            [2, "100.1"],
            [3, "90.05"],
            [5, "90.05"],
            [6, "80.01"],
          ] as const) {
            const r = await post(input(n));
            assert.equal(r.status, 201, JSON.stringify(r.body));
            assert.equal(
              r.body.data.detalles[0].precio_unitario_aplicado,
              price,
            );
            assert.equal(
              Number(r.body.data.monto_neto),
              Math.round((Number(price) * n - 10) * 100) / 100,
            );
            assert.equal(
              Number(r.body.data.total_cobrado),
              Math.round((Number(price) * n + 5.25) * 100) / 100,
            );
          }
          const r = await post(input(6, b));
          assert.equal(r.status, 201);
          assert.equal(r.body.data.monto_vestidos, "303.3");
          sale = (await post(input())).body.data;
        },
      );
      await t.test(
        "cantidad total de modelos mixtos y envío separado",
        async () => {
          const body = {
            ...input(),
            detalles: [
              { id_variante: v, cantidad: 2 },
              { id_variante: b, cantidad: 1 },
            ],
            departamento_destino: "La_Paz",
            ciudad_provincia: "El Alto",
            costo_envio: "20.50",
          };
          const r = await post(body);
          assert.equal(r.status, 201, JSON.stringify(r.body));
          assert.equal(r.body.data.monto_vestidos, "230.65");
          assert.equal(r.body.data.total_cobrado, "256.4");
          assert.equal(r.body.data.monto_neto, "220.65");
        },
      );
      await t.test(
        "reintento de registro no duplica venta ni stock",
        async () => {
          const body = input(),
            before = await prisma.venta.count();
          const a = await post(body),
            stock = (
              await prisma.varianteVestido.findUniqueOrThrow({
                where: { id_variante: v },
              })
            ).cantidad_stock;
          const again = await post(body);
          assert.equal(a.body.data.id_venta, again.body.data.id_venta);
          assert.equal(await prisma.venta.count(), before + 1);
          assert.equal(
            (
              await prisma.varianteVestido.findUniqueOrThrow({
                where: { id_variante: v },
              })
            ).cantidad_stock,
            stock,
          );
        },
      );
      await t.test(
        "cambio de variante y rollback al editar sin stock",
        async () => {
          const before = (
            await prisma.varianteVestido.findUniqueOrThrow({
              where: { id_variante: v },
            })
          ).cantidad_stock;
          const invalid = await request(app)
            .put(`/api/ventas/${sale.id_venta}`)
            .set(auth)
            .send({ ...input(500), version: sale.version });
          assert.equal(invalid.status, 409);
          assert.equal(
            (
              await prisma.varianteVestido.findUniqueOrThrow({
                where: { id_variante: v },
              })
            ).cantidad_stock,
            before,
          );
          const r = await request(app)
            .put(`/api/ventas/${sale.id_venta}`)
            .set(auth)
            .send({ ...input(2, v2), version: sale.version });
          assert.equal(r.status, 200, JSON.stringify(r.body));
          assert.equal(r.body.data.numero_diario, sale.numero_diario);
          assert.equal(
            (
              await prisma.varianteVestido.findUniqueOrThrow({
                where: { id_variante: v },
              })
            ).cantidad_stock,
            before + 1,
          );
          assert.equal(
            (
              await request(app)
                .put(`/api/ventas/${sale.id_venta}`)
                .set(auth)
                .send({ ...input(), version: sale.version })
            ).status,
            409,
          );
          sale = r.body.data;
        },
      );
      await t.test(
        "cancelar devuelve stock una vez y conserva el correlativo",
        async () => {
          const before = (
            await prisma.varianteVestido.findUniqueOrThrow({
              where: { id_variante: v2 },
            })
          ).cantidad_stock;
          for (let i = 0; i < 2; i++)
            assert.equal(
              (
                await request(app)
                  .post(`/api/ventas/${sale.id_venta}/cancelar`)
                  .set(auth)
                  .send({ version: sale.version })
              ).status,
              200,
            );
          assert.equal(
            (
              await prisma.varianteVestido.findUniqueOrThrow({
                where: { id_variante: v2 },
              })
            ).cantidad_stock,
            before + 2,
          );
          assert.equal(
            (
              await request(app)
                .put(`/api/ventas/${sale.id_venta}`)
                .set(auth)
                .send({ ...input(), version: sale.version })
            ).status,
            409,
          );
          const r = await post(input());
          assert.ok(r.body.data.numero_diario > sale.numero_diario);
        },
      );
      await t.test(
        "dos compras simultáneas no sobre venden la última unidad",
        async () => {
          const limited = await prisma.varianteVestido.create({
            data: {
              id_vestido: dress.id_vestido,
              color: "Único",
              cantidad_stock: 1,
            },
          });
          const results = await Promise.all([
            post(input(1, limited.id_variante)),
            post(input(1, limited.id_variante)),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          assert.equal(
            (
              await prisma.varianteVestido.findUniqueOrThrow({
                where: { id_variante: limited.id_variante },
              })
            ).cantidad_stock,
            0,
          );
        },
      );
      await t.test(
        "correlativos concurrentes y día comercial boliviano",
        async () => {
          const results = await Promise.all([
            post(input()),
            post(input()),
            post(input()),
          ]);
          for (const r of results)
            assert.equal(r.status, 201, JSON.stringify(r.body));
          assert.equal(
            new Set(results.map((r) => r.body.data.numero_diario)).size,
            3,
          );
          assert.equal(
            boliviaDay(new Date("2026-10-31T03:59:59Z")),
            "2026-10-30",
          );
          assert.equal(
            boliviaDay(new Date("2026-10-31T04:00:00Z")),
            "2026-10-31",
          );
          assert.equal(
            (await request(app).get("/api/ventas?fecha=2026-02-30").set(auth))
              .status,
            400,
          );
          assert.equal(
            (await request(app).get("/api/ventas?fecha=2020-01-01").set(auth))
              .body.data.length,
            0,
          );
        },
      );
      await t.test(
        "PDF usa datos históricos y solo pedidos válidos seleccionados",
        async () => {
          const first = (await post(input(1))).body.data;
          await prisma.vestido.update({
            where: { id_vestido: dress.id_vestido },
            data: { nombre: "Otro nombre", precio_unitario: "999" },
          });
          await post({
            ...input(),
            cliente: {
              celular: "70000001",
              nombre: "Otro cliente",
              direccion_entrega: "Nueva dirección",
            },
          });
          const listed = (
            await request(app).get("/api/ventas").set(auth)
          ).body.data.find((s: any) => s.id_venta === first.id_venta);
          assert.equal(listed.cliente_nombre, "Cliente");
          assert.equal(listed.detalles[0].nombre_vestido, "Aurora");
          assert.equal(listed.detalles[0].precio_unitario_aplicado, "100.1");
          const bad = await request(app)
            .post("/api/ventas/imprimir")
            .set(auth)
            .send({ fecha: boliviaDay(), ids: [sale.id_venta] });
          assert.equal(bad.status, 409);
          const r = await request(app)
            .post("/api/ventas/imprimir")
            .set(auth)
            .send({
              fecha: boliviaDay(),
              ids: [first.id_venta, listed.id_venta],
            });
          assert.equal(r.status, 200);
          assert.match(r.headers["content-type"], /application\/pdf/);
          assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
          if (process.env.SALES_PDF_SAMPLE)
            await writeFile(process.env.SALES_PDF_SAMPLE, r.body);
        },
      );
      await t.test(
        "PDF multipedido con 55 líneas largas y neto negativo válido",
        async () => {
          const rows = await Promise.all(
            Array.from({ length: 55 }, (_, i) =>
              prisma.varianteVestido.create({
                data: {
                  id_vestido: basic.id_vestido,
                  color: `Color largo de prueba ${i}`,
                  talla: "Talla XL",
                  cantidad_stock: 3,
                },
              }),
            ),
          );
          const long = (
            await post({
              ...input(),
              detalles: rows.map((v) => ({
                id_variante: v.id_variante,
                cantidad: 1,
              })),
              departamento_destino: "Santa_Cruz",
              ciudad_provincia: "Ciudad de destino para el pedido de prueba",
              costo_envio: "22.50",
            })
          ).body.data;
          assert.ok(long?.id_venta);
          const cheap = await prisma.vestido.create({
            data: {
              nombre: "Prenda pequeña",
              descripcion: "Precio menor al delivery",
              id_propietario: owner.id_propietario,
              precio_unitario: "5",
              variantes: { create: { color: "Azul", cantidad_stock: 1 } },
            },
            include: { variantes: true },
          });
          const small = await post(input(1, cheap.variantes[0].id_variante));
          assert.equal(small.status, 201);
          assert.equal(small.body.data.monto_neto, "-5");
          const pdf = await request(app)
            .post("/api/ventas/imprimir")
            .set(auth)
            .send({
              fecha: boliviaDay(),
              ids: [long.id_venta, small.body.data.id_venta],
            });
          assert.equal(pdf.status, 200);
          if (process.env.SALES_PDF_LONG_SAMPLE)
            await writeFile(process.env.SALES_PDF_LONG_SAMPLE, pdf.body);
        },
      );
    } finally {
      await prisma.$disconnect();
      await socket.stop();
      await db.close();
    }
  },
);
