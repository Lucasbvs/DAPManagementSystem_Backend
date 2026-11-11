import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import request from "supertest";
import jwt from "jsonwebtoken";

test(
  "Horarios, dueños, canceladas y cambios independientes",
  { timeout: 120000 },
  async (t) => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:55446/postgres";
    process.env.JWT_SECRET =
      "sales-enhancements-test-only-secret-32-characters";
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
      port: 55446,
      host: "127.0.0.1",
      maxConnections: 10,
    });
    await socket.start();
    const { app } = await import("../src/app.js"),
      { prisma } = await import("../src/services/prisma.service.js"),
      { boliviaDay } = await import("../src/services/ventas.service.js");
    try {
      const user = await prisma.user.create({
        data: {
          name: "Test",
          email: "extras@test.local",
          passwordHash: "test",
        },
      });
      const owners = await Promise.all(
        ["Ana", "Dylan"].map((nombre) =>
          prisma.propietario.create({ data: { nombre } }),
        ),
      );
      const variants = [];
      for (const [i, price] of ["100", "150", "75", "100"].entries()) {
        const d = await prisma.vestido.create({
          data: {
            nombre: ["Aurora", "Emma", "Luna", "Dalia"][i],
            descripcion: "Prenda",
            ubicacion_almacen: `A${i + 1}`,
            id_propietario: owners[i % 2].id_propietario,
            precio_unitario: price,
            variantes: {
              create: { color: "Verde", talla: "M", cantidad_stock: 100 },
            },
          },
          include: { variantes: true },
        });
        variants.push(d.variantes[0]);
      }
      const [a, b, c, e] = variants.map((v) => v.id_variante);
      const auth = {
        Authorization: `Bearer ${jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), issuer: "dap-api", audience: "dap-web", expiresIn: "1h" })}`,
      };
      const input = (id = a) => ({
        hora_entrega_desde: "14:30",
        hora_entrega_hasta: null,
        clave_registro: randomUUID(),
        cliente: {
          celular: "70000001",
          nombre: "Cliente",
          direccion_entrega: "Av. América",
          link_ubicacion: "https://maps.google.com/?q=Cochabamba",
        },
        detalles: [{ id_variante: id, cantidad: 1 }],
        departamento_destino: null,
        ciudad_provincia: null,
        costo_envio: null,
      });
      const post = (data: unknown) =>
        request(app).post("/api/ventas").set(auth).send(data);
      const fresh = async (id: number) =>
        prisma.venta.findUniqueOrThrow({
          where: { id_venta: id },
          include: { detalles: true },
        });
      const create = async (id = a) => {
        const r = await post(input(id));
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return r.body.data;
      };
      const change = (sale: any, id = b, quantity = 1) => ({
        clave_registro: randomUUID(),
        version: sale.version,
        hora_entrega_desde: "14:00",
        hora_entrega_hasta: "16:00",
        devoluciones: [
          {
            id_detalle: sale.detalles.find((d: any) => d.tipo === "Entrega")
              .id_detalle,
            cantidad: 1,
          },
        ],
        entregas: [{ id_variante: id, cantidad: quantity }],
      });
      const exchange = (sale: any, data: unknown) =>
        request(app)
          .post(`/api/ventas/${sale.id_venta}/cambios`)
          .set(auth)
          .send(data);
      const stock = async (id: number) =>
        (
          await prisma.varianteVestido.findUniqueOrThrow({
            where: { id_variante: id },
          })
        ).cantidad_stock;
      await t.test(
        "compra V-001, cambio V-002 y siguiente compra V-003 sin borrar historial",
        async () => {
          const source = await create();
          assert.equal(source.numero_diario, 1);
          const changed = await exchange(source, change(source, b));
          assert.equal(changed.status, 201, JSON.stringify(changed.body));
          assert.equal(changed.body.data.numero_diario, 2);
          const third = await create();
          assert.equal(third.numero_diario, 3);
          assert.equal(await prisma.venta.count(), 3);
          assert.equal(
            (
              await request(app)
                .post(`/api/ventas/${third.id_venta}/cancelar`)
                .set(auth)
                .send({ version: third.version })
            ).status,
            200,
          );
          const fourth = await create();
          assert.equal(fourth.numero_diario, 4);
          assert.ok(
            await prisma.venta.findUnique({
              where: { id_venta: changed.body.data.id_venta },
            }),
          );
        },
      );
      await t.test(
        "correlativo SQL comparte día del índice único en diferentes zonas de sesión",
        async () => {
          const { nextSaleNumber } =
            await import("../src/services/saleNumber.service.js");
          const client = await prisma.cliente.findFirstOrThrow();
          const base = {
            id_cliente: client.id_cliente,
            total_prendas: 1,
            tarifa_aplicada: "unitario" as const,
            monto_vestidos: "100",
            total_cobrado: "100",
            monto_neto: "90",
          };
          const previous = await prisma.venta.create({
            data: {
              ...base,
              fecha: new Date("2026-01-01T03:59:59Z"),
              numero_diario: 12,
            },
          });
          await prisma.venta.create({
            data: {
              ...base,
              fecha: new Date("2026-01-01T04:00:00Z"),
              numero_diario: 2,
            },
          });
          await prisma.venta.create({
            data: {
              ...base,
              fecha: new Date("2026-01-02T03:59:59Z"),
              numero_diario: 7,
              estado: "Cancelada",
            },
          });
          await prisma.venta.create({
            data: {
              ...base,
              fecha: new Date("2026-01-01T12:00:00Z"),
              numero_diario: 9,
              tipo: "Cambio",
              id_venta_origen: previous.id_venta,
              costo_delivery: "0",
              monto_devolucion: "50",
              total_cobrado: "50",
              monto_neto: "50",
            },
          });
          for (const zone of ["UTC", "America/La_Paz", "Asia/Tokyo"]) {
            const numbers = await prisma.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT set_config('TimeZone',${zone},true)`;
              return Promise.all(
                [
                  new Date("2026-01-01T03:59:59Z"),
                  new Date("2026-01-01T04:00:00Z"),
                  new Date("2026-01-02T04:00:00Z"),
                ].map((date) => nextSaleNumber(tx, date)),
              );
            });
            assert.deepEqual(numbers, [13, 10, 1]);
          }
        },
      );
      await t.test(
        "hora fija/rango, adicional omitido/vacío y provincia opcional",
        async () => {
          const first = await create();
          assert.equal(first.adicional_delivery, "0");
          assert.equal(first.hora_entrega_desde, "14:30");
          assert.equal(first.hora_entrega_hasta, null);
          const r = await post({
            ...input(),
            hora_entrega_desde: "14:00",
            hora_entrega_hasta: "16:00",
            adicional_delivery: "",
            departamento_destino: "La_Paz",
            costo_envio: "20",
          });
          assert.equal(r.status, 201, JSON.stringify(r.body));
          assert.equal(r.body.data.ciudad_provincia, null);
          assert.equal(r.body.data.total_cobrado, "120");
          for (const schedule of [
            { hora_entrega_desde: "" },
            { hora_entrega_desde: "25:00" },
            { hora_entrega_desde: "14:00", hora_entrega_hasta: "14:00" },
            { hora_entrega_desde: "14:00", hora_entrega_hasta: "13:00" },
            { hora_entrega_desde: null },
          ])
            assert.equal((await post({ ...input(), ...schedule })).status, 400);
          const { hora_entrega_desde, ...missing } = input();
          assert.equal((await post(missing)).status, 400);
        },
      );
      await t.test(
        "nuevo cambio cobra diferencia, mantiene el original y mueve stock una sola vez",
        async () => {
          const source = await create(),
            beforeA = await stock(a),
            beforeB = await stock(b),
            count = await prisma.venta.count(),
            body = change(source);
          const r = await exchange(source, body);
          assert.equal(r.status, 201, JSON.stringify(r.body));
          const changed = r.body.data;
          assert.equal(await prisma.venta.count(), count + 1);
          assert.notEqual(changed.id_venta, source.id_venta);
          assert.equal(changed.tipo, "Cambio");
          assert.equal(changed.id_venta_origen, source.id_venta);
          assert.equal(changed.total_cobrado, "50");
          assert.equal(changed.monto_neto, "50");
          assert.equal(changed.costo_delivery, "0");
          assert.equal(changed.monto_devolucion, "100");
          assert.equal(await stock(a), beforeA + 1);
          assert.equal(await stock(b), beforeB - 1);
          const original = await fresh(source.id_venta);
          assert.equal(original.total_cobrado.toString(), source.total_cobrado);
          assert.equal(
            original.detalles[0].id_detalle,
            source.detalles[0].id_detalle,
          );
          assert.equal(original.detalles[0].cantidad, 1);
          assert.equal(
            (await exchange(source, body)).body.data.id_venta,
            changed.id_venta,
          );
          assert.equal(await stock(a), beforeA + 1);
          assert.equal(await stock(b), beforeB - 1);
          assert.equal(
            (
              await request(app)
                .put(`/api/ventas/${source.id_venta}`)
                .set(auth)
                .send({ ...input(), version: original.version })
            ).status,
            409,
          );
          assert.equal(
            (
              await request(app)
                .post(`/api/ventas/${source.id_venta}/cancelar`)
                .set(auth)
                .send({ version: original.version })
            ).status,
            409,
          );
          assert.equal(
            (await exchange(original, change(original, c))).status,
            409,
          );
        },
      );
      await t.test(
        "cambios con devolución de dinero, sin diferencia y sin stock: rollback",
        async () => {
          for (const [id, amount] of [
            [c, "-25"],
            [e, "0"],
          ] as const) {
            const sale = await create();
            const r = await exchange(sale, change(sale, id));
            assert.equal(r.status, 201, JSON.stringify(r.body));
            assert.equal(r.body.data.total_cobrado, amount);
          }
          const source = await create(),
            before = await stock(a),
            count = await prisma.venta.count();
          assert.equal(
            (await exchange(source, change(source, b, 1000))).status,
            409,
          );
          assert.equal(await stock(a), before);
          assert.equal(await prisma.venta.count(), count);
          assert.equal((await fresh(source.id_venta)).version, source.version);
          assert.equal((await exchange(source, change(source, a))).status, 400);
        },
      );
      await t.test(
        "cambios encadenados se cancelan de atrás hacia adelante y no duplican stock",
        async () => {
          const source = await create(),
            originalA = await stock(a),
            originalB = await stock(b),
            originalC = await stock(c);
          const first = (await exchange(source, change(source, b))).body.data;
          const second = (await exchange(first, change(first, c))).body.data;
          assert.ok(second.id_venta);
          assert.equal(
            (
              await request(app)
                .post(`/api/ventas/${first.id_venta}/cancelar`)
                .set(auth)
                .send({ version: (await fresh(first.id_venta)).version })
            ).status,
            409,
          );
          for (const sale of [second, first])
            for (let i = 0; i < 2; i++)
              assert.equal(
                (
                  await request(app)
                    .post(`/api/ventas/${sale.id_venta}/cancelar`)
                    .set(auth)
                    .send({ version: (await fresh(sale.id_venta)).version })
                ).status,
                200,
              );
          assert.equal(await stock(a), originalA);
          assert.equal(await stock(b), originalB);
          assert.equal(await stock(c), originalC);
          assert.equal(
            (
              await request(app)
                .post(`/api/ventas/${source.id_venta}/cancelar`)
                .set(auth)
                .send({ version: (await fresh(source.id_venta)).version })
            ).status,
            200,
          );
          assert.equal(await stock(a), originalA + 1);
        },
      );
      await t.test(
        "no revierte un cambio si la prenda devuelta ya se vendió y no queda stock",
        async () => {
          const source = await create(),
            ex = (await exchange(source, change(source, b))).body.data;
          await prisma.varianteVestido.update({
            where: { id_variante: a },
            data: { cantidad_stock: 0 },
          });
          assert.equal(
            (
              await request(app)
                .post(`/api/ventas/${ex.id_venta}/cancelar`)
                .set(auth)
                .send({ version: ex.version })
            ).status,
            409,
          );
          assert.equal((await fresh(ex.id_venta)).estado, "Realizada");
          assert.equal(await stock(a), 0);
          await prisma.varianteVestido.update({
            where: { id_variante: a },
            data: { cantidad_stock: 100 },
          });
        },
      );
      await t.test(
        "dos cambios simultáneos no devuelven dos veces y las devoluciones parciales respetan el saldo",
        async () => {
          const source = await create(),
            before = await stock(a);
          const results = await Promise.all([
            exchange(source, change(source, b)),
            exchange(source, change(source, c)),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          assert.equal(await stock(a), before + 1);
          const r = await post({
            ...input(),
            detalles: [{ id_variante: a, cantidad: 2 }],
          });
          assert.equal(r.status, 201);
          const partial = r.body.data;
          assert.equal(
            (await exchange(partial, change(partial, b))).status,
            201,
          );
          const next = await fresh(partial.id_venta);
          assert.equal((await exchange(next, change(next, c))).status, 201);
          const last = await fresh(partial.id_venta);
          assert.equal((await exchange(last, change(last, e))).status, 409);
        },
      );
      await t.test(
        "filtro por dueño histórico conserva pedidos mixtos; canceladas al fondo",
        async () => {
          const mix = await post({
            ...input(),
            detalles: [
              { id_variante: a, cantidad: 1 },
              { id_variante: b, cantidad: 1 },
            ],
          });
          assert.equal(mix.status, 201);
          const id = mix.body.data.id_venta;
          await prisma.vestido.update({
            where: { id_vestido: variants[0].id_vestido },
            data: { id_propietario: owners[1].id_propietario },
          });
          const filtered = await request(app)
            .get(`/api/ventas?propietario=${owners[0].id_propietario}`)
            .set(auth);
          assert.equal(filtered.status, 200);
          const found = filtered.body.data.find((s: any) => s.id_venta === id);
          assert.equal(found.detalles.length, 2);
          assert.equal(
            found.detalles[0].id_propietario_venta,
            owners[0].id_propietario,
          );
          const rows = (await request(app).get("/api/ventas").set(auth)).body
            .data;
          let cancelled = false;
          for (const row of rows) {
            if (row.estado === "Cancelada") cancelled = true;
            else assert.equal(cancelled, false);
          }
          assert.equal(
            (await request(app).get("/api/ventas?propietario=abc").set(auth))
              .status,
            400,
          );
        },
      );
      await t.test(
        "PDF de cambio incluye devolución, entrega, diferencia y horario",
        async () => {
          const source = await create();
          const ex = (await exchange(source, change(source, c))).body.data;
          const r = await request(app)
            .post("/api/ventas/imprimir")
            .set(auth)
            .send({ fecha: boliviaDay(), ids: [ex.id_venta] });
          assert.equal(r.status, 200);
          assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
          if (process.env.SALES_EXCHANGE_PDF)
            await writeFile(process.env.SALES_EXCHANGE_PDF, r.body);
        },
      );
    } finally {
      await prisma.$disconnect();
      await socket.stop();
      await db.close();
    }
  },
);
