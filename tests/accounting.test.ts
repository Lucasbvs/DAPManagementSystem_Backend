import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import request from "supertest";
import jwt from "jsonwebtoken";

test("Contabilidad por propietario y ventas entregadas", { timeout: 120000 }, async (t) => {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55452/postgres";
  process.env.JWT_SECRET = "accounting-tests-only-secret-123456789";
  process.env.NODE_ENV = "test";
  const db = await PGlite.create();
  for (const dir of (await readdir("prisma/migrations", { withFileTypes: true })).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)))
    await db.exec(await readFile(`prisma/migrations/${dir.name}/migration.sql`, "utf8"));
  const socket = new PGLiteSocketServer({ db, port: 55452, host: "127.0.0.1", maxConnections: 10 });
  await socket.start();
  const { app } = await import("../src/app.js");
  const { prisma } = await import("../src/services/prisma.service.js");
  const { boliviaDay } = await import("../src/services/ventas.service.js");
  try {
    const user = await prisma.user.create({ data: { name: "Test", email: "accounting@test.local", passwordHash: "test" } });
    const ana = await prisma.propietario.create({ data: { nombre: "Ana" } });
    const dylan = await prisma.propietario.create({ data: { nombre: "Dylan" } });
    const dress = await prisma.vestido.create({
      data: { nombre: "Aurora", descripcion: "Test", precio_unitario: "100", id_propietario: ana.id_propietario, variantes: { create: { color: "Verde", cantidad_stock: 100 } } },
      include: { variantes: true },
    });
    const variant = dress.variantes[0].id_variante;
    const replacementDress = await prisma.vestido.create({
      data: { nombre: "Emma", descripcion: "Test", precio_unitario: "100", id_propietario: dylan.id_propietario, variantes: { create: { color: "Azul", cantidad_stock: 100 } } },
      include: { variantes: true },
    });
    const replacementVariant = replacementDress.variantes[0].id_variante;
    const auth = { Authorization: `Bearer ${jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), issuer: "dap-api", audience: "dap-web", expiresIn: "1h" })}` };
    const month = boliviaDay().slice(0, 7);
    const report = async (mes = month) => {
      const response = await request(app).get("/api/contabilidad").query({ mes }).set(auth);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.data;
    };
    const makeSale = async () => {
      const response = await request(app).post("/api/ventas").set(auth).send({
        clave_registro: randomUUID(), hora_entrega_desde: "14:00", cliente: { celular: "70000001", nombre: "Cliente" },
        detalles: [{ id_variante: variant, cantidad: 3 }],
        importes_propietario: [{ id_propietario: ana.id_propietario, monto_prendas: "100" }],
        adicional_delivery: "15", departamento_destino: "La_Paz", forma_pago: "Pagado", costo_envio: "20",
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body.data;
    };
    const confirm = async (sale: any, quantity?: number) => {
      const response = await request(app).post(`/api/ventas/${sale.id_venta}/entrega`).set(auth).send({
        version: sale.version,
        entregas: sale.detalles.filter((line: any) => line.tipo === "Entrega").map((line: any) => ({ id_detalle: line.id_detalle, cantidad: quantity ?? line.cantidad })),
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.data;
    };
    let sale: any;
    await t.test("requiere sesión, valida mes y muestra ceros sin datos", async () => {
      assert.equal((await request(app).get("/api/contabilidad")).status, 401);
      for (const mes of ["2026-13", "2026-1", "0000-01", "mal"]) assert.equal((await request(app).get("/api/contabilidad").query({ mes }).set(auth)).status, 400);
      const empty = await report();
      assert.deepEqual(empty.totales, { ingresos: "0.00", costos_gastos: "0.00", resultado: "0.00" });
      assert.equal(empty.propietarios.length, 2);
    });
    await t.test("pendientes excluidas; entrega parcial descuenta exactamente y no suma delivery/envío", async () => {
      sale = await makeSale();
      assert.equal((await report()).movimientos.length, 0);
      const pending = await prisma.venta.findUniqueOrThrow({ where: { id_venta: sale.id_venta } });
      assert.equal(pending.estado, "Pendiente");
      const delivered = await confirm(sale, 2);
      assert.equal(delivered.monto_vestidos, "66.67");
      const first = await report();
      assert.equal(first.totales.ingresos, "66.67");
      assert.equal(first.propietarios[0].ingresos, "66.67");
      assert.equal(first.propietarios[1].ingresos, "0.00");
      await confirm(sale, 2);
      assert.equal((await report()).totales.ingresos, "66.67");
      sale = delivered;
    });
    await t.test("dueño histórico conserva ingresos aunque cambie el catálogo", async () => {
      await prisma.vestido.update({ where: { id_vestido: dress.id_vestido }, data: { id_propietario: dylan.id_propietario } });
      assert.equal((await report()).propietarios[0].ingresos, "66.67");
      await prisma.vestido.update({ where: { id_vestido: dress.id_vestido }, data: { id_propietario: ana.id_propietario } });
    });
    await t.test("reemplazo completo pendiente excluye la original; entregarlo cuenta una sola vez", async () => {
      const response = await request(app).post(`/api/ventas/${sale.id_venta}/cambios`).set(auth).send({
        clave_registro: randomUUID(), version: sale.version, hora_entrega_desde: "15:00",
        devoluciones: [{ id_detalle: sale.detalles[0].id_detalle, cantidad: 1 }], entregas: [{ id_variante: replacementVariant, cantidad: 1 }],
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.equal((await report()).totales.ingresos, "0.00");
      sale = await confirm(response.body.data);
      assert.equal((await report()).totales.ingresos, "133.33");
      assert.equal((await report()).movimientos.length, 2);
      assert.equal((await report()).propietarios[0].ingresos, "33.33");
      assert.equal((await report()).propietarios[1].ingresos, "100.00");
    });
    await t.test("cancelar quita ingresos; las consultas no cambian estados", async () => {
      const response = await request(app).post(`/api/ventas/${sale.id_venta}/cancelar`).set(auth).send({ version: sale.version });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal((await report()).totales.ingresos, "0.00");
      const old = await makeSale();
      await prisma.venta.update({ where: { id_venta: old.id_venta }, data: { fecha: new Date("2026-01-01T12:00:00Z") } });
      await report("2026-01");
      assert.equal((await prisma.venta.findUniqueOrThrow({ where: { id_venta: old.id_venta } })).estado, "Pendiente");
    });
    await t.test("gastos validados, asociados al contribuyente y acumulados sin ingresos duplicados", async () => {
      const expense = { fecha: `${month}-01`, concepto: "  Compra de bolsas  ", tipo: "Gasto", importe: "12.50", id_propietario: dylan.id_propietario };
      assert.equal((await request(app).post("/api/contabilidad/gastos").send(expense)).status, 401);
      for (const patch of [{ importe: "0" }, { importe: "-1" }, { importe: "1.001" }, { tipo: "Ingreso" }, { concepto: " " }, { fecha: "2026-02-30" }, { id_venta: sale.id_venta }])
        assert.equal((await request(app).post("/api/contabilidad/gastos").set(auth).send({ ...expense, ...patch })).status, 400);
      assert.equal((await request(app).post("/api/contabilidad/gastos").set(auth).send({ ...expense, id_propietario: 99999 })).status, 404);
      const saved = await request(app).post("/api/contabilidad/gastos").set(auth).send(expense);
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      assert.equal(saved.body.data.concepto, "Compra de bolsas");
      assert.equal((await request(app).post("/api/contabilidad/gastos").set(auth).send({ ...expense, concepto: "Mercadería", tipo: "Costo", importe: "20" })).status, 201);
      await prisma.movimientoContabilidad.create({ data: { ...expense, fecha: new Date(`${month}-01T00:00:00Z`), tipo: "Ingreso", importe: "999", id_venta: sale.id_venta } });
      const totals = await report();
      assert.deepEqual(totals.totales, { ingresos: "0.00", costos_gastos: "32.50", resultado: "-32.50" });
      assert.equal(totals.propietarios[1].resultado, "-32.50");
    });
    await t.test("límites mensuales respetan Bolivia, cambio incremental histórico y fechas Date", async () => {
      const base = await makeSale();
      const delivered = await confirm(base, 3);
      await prisma.venta.update({ where: { id_venta: delivered.id_venta }, data: { fecha: new Date("2026-03-01T03:59:59.999Z") } });
      assert.equal((await report("2026-02")).totales.ingresos, "100.00");
      assert.equal((await report("2026-03")).totales.ingresos, "0.00");
      await prisma.venta.update({ where: { id_venta: delivered.id_venta }, data: { fecha: new Date("2026-03-01T04:00:00Z") } });
      assert.equal((await report("2026-02")).totales.ingresos, "0.00");
      assert.equal((await report("2026-03")).totales.ingresos, "100.00");
      await prisma.venta.update({ where: { id_venta: delivered.id_venta }, data: { tipo: "Cambio", id_venta_origen: sale.id_venta, reemplazo_completo: false,
        costo_delivery: "0", adicional_delivery: "0", costo_envio: null, monto_devolucion: "20", total_cobrado: "80", monto_neto: "80", detalles: { create: {
        tipo: "Devolucion", id_variante: variant, cantidad: 1, precio_unitario_aplicado: "25", descuento_manual: "5", id_propietario_venta: ana.id_propietario,
      } } } });
      assert.equal((await report("2026-03")).totales.ingresos, "80.00");
      const expense = await request(app).post("/api/contabilidad/gastos").set(auth).send({ fecha: "2026-02-28", concepto: "Fin de mes", tipo: "Gasto", importe: "3.25", id_propietario: ana.id_propietario });
      assert.equal(expense.status, 201);
      assert.equal((await report("2026-02")).totales.costos_gastos, "3.25");
      assert.equal((await report("2026-03")).totales.costos_gastos, "0.00");
    });
  } finally {
    await prisma.$disconnect();
    await socket.stop();
    await db.close();
  }
});
