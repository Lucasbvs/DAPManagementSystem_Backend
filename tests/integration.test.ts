import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

test(
  "API y restricciones sobre PostgreSQL embebido desechable",
  { timeout: 60000 },
  async (t) => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:55439/postgres";
    process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";
    process.env.NODE_ENV = "test";
    const db = await PGlite.create();
    for (const entry of (
      await readdir("prisma/migrations", { withFileTypes: true })
    )
      .filter((x) => x.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await db.exec(
        await readFile(`prisma/migrations/${entry.name}/migration.sql`, "utf8"),
      );
    const server = new PGLiteSocketServer({
      db,
      port: 55439,
      host: "127.0.0.1",
      maxConnections: 10,
    });
    await server.start();
    const { app } = await import("../src/app.js");
    const { prisma } = await import("../src/services/prisma.service.js");
    try {
      const user = await prisma.user.create({
        data: {
          email: "test@dap.local",
          name: "Test",
          passwordHash: await bcrypt.hash("test-password-123", 12),
        },
      });
      const owner = await prisma.propietario.create({
        data: { nombre: "Ana" },
      });
      let token = "";
      let dressId = 0;
      let variantId = 0;
      const input = {
        ubicacion_almacen: "A1",
        nombre: "Aurora",
        descripcion: "Satén",
        precio_unitario: "95.10",
        precio_cuarta: "85.00",
        precio_media_docena: "75.00",
        id_propietario: owner.id_propietario,
        variantes: [{ color: "Verde", talla: "M", cantidad_stock: 5 }],
      };
      await t.test(
        "401 uniforme para ruta protegida, JWT inválido y vencido",
        async () => {
          for (const value of [
            "",
            "Bearer invalid",
            `Bearer ${jwt.sign({}, process.env.JWT_SECRET!, { subject: String(user.id), expiresIn: -1, issuer: "dap-api", audience: "dap-web" })}`,
          ]) {
            const r = await request(app)
              .get("/api/vestidos")
              .set("Authorization", value);
            assert.equal(r.status, 401);
            assert.equal(r.body.success, false);
            assert.equal(r.body.data, null);
          }
        },
      );
      await t.test(
        "login correcto, contraseña incorrecta y usuario inexistente",
        async () => {
          for (const email of ["test@dap.local", "missing@dap.local"]) {
            const r = await request(app)
              .post("/api/auth/login")
              .send({ email, password: "wrong" });
            assert.equal(r.status, 401);
          }
          const r = await request(app)
            .post("/api/auth/login")
            .send({ email: "test@dap.local", password: "test-password-123" });
          assert.equal(r.status, 200);
          token = r.body.data.token;
          assert.ok(token);
          assert.equal(r.body.data.user.passwordHash, undefined);
        },
      );
      await t.test(
        "sesión normal de 8h y persistente de 30 días; rememberMe validado",
        async () => {
          for (const [rememberMe, seconds] of [
            [false, 8 * 3600],
            [true, 30 * 86400],
          ] as const) {
            const r = await request(app)
              .post("/api/auth/login")
              .send({
                email: "test@dap.local",
                password: "test-password-123",
                rememberMe,
              });
            assert.equal(r.status, 200);
            const payload = jwt.decode(r.body.data.token) as jwt.JwtPayload;
            assert.equal(payload.exp! - payload.iat!, seconds);
          }
          assert.equal(
            (
              await request(app)
                .post("/api/auth/login")
                .send({
                  email: "test@dap.local",
                  password: "test-password-123",
                  rememberMe: "true",
                })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "cuentas privadas, sin registro público y mismos permisos",
        async () => {
          const { createAccount, deactivateAccount } =
            await import("../src/services/accounts.service.js");
          const user2 = await createAccount({
            name: "Persona 2",
            email: " PERSONA2@dap.local ",
            password: "another-password-123",
          });
          assert.equal(user2.email, "persona2@dap.local");
          assert.equal(user2.active, true);
          await assert.rejects(() =>
            createAccount({
              name: "Duplicado",
              email: "persona2@dap.local",
              password: "another-password-123",
            }),
          );
          await assert.rejects(() =>
            createAccount({
              name: "Inválido",
              email: "invalid@dap.local",
              password: "short",
            }),
          );
          const r = await request(app)
            .post("/api/auth/login")
            .send({
              email: user2.email,
              password: "another-password-123",
              rememberMe: true,
            });
          assert.equal(r.status, 200);
          assert.equal(
            (
              await request(app)
                .get("/api/vestidos")
                .set("Authorization", `Bearer ${r.body.data.token}`)
            ).status,
            200,
          );
          assert.equal(
            (await request(app).post("/api/auth/register").send({})).status,
            401,
          );
          assert.equal(
            (
              await request(app)
                .post("/api/auth/register")
                .set("Authorization", `Bearer ${r.body.data.token}`)
                .send({})
            ).status,
            404,
          );
          await deactivateAccount(user2.email);
          assert.equal(
            (
              await request(app)
                .get("/api/vestidos")
                .set("Authorization", `Bearer ${r.body.data.token}`)
            ).status,
            401,
          );
        },
      );
      const auth = () => ({ Authorization: `Bearer ${token}` });
      await t.test(
        "crear, listar y sumar stock; precisión decimal",
        async () => {
          const r = await request(app)
            .post("/api/vestidos")
            .set(auth())
            .send(input);
          assert.equal(r.status, 201, JSON.stringify(r.body));
          dressId = r.body.data.id_vestido;
          variantId = r.body.data.variantes[0].id_variante;
          const list = await request(app).get("/api/vestidos").set(auth());
          assert.equal(list.body.data[0].stock_total, 5);
          assert.equal(list.body.data[0].precio_unitario, "95.1");
        },
      );
      await t.test(
        "rechazar negativos, duplicados y FK inexistente",
        async () => {
          for (const data of [
            { ...input, precio_unitario: "-1" },
            {
              ...input,
              variantes: [{ color: "V", talla: null, cantidad_stock: -1 }],
            },
            { ...input, variantes: [input.variantes[0], input.variantes[0]] },
          ])
            assert.equal(
              (await request(app).post("/api/vestidos").set(auth()).send(data))
                .status,
              400,
            );
          assert.equal(
            (
              await request(app)
                .post("/api/vestidos")
                .set(auth())
                .send({ ...input, id_propietario: 99999 })
            ).status,
            409,
          );
        },
      );
      await t.test(
        "editar mantiene ID de variante y cambia stock",
        async () => {
          const r = await request(app)
            .put(`/api/vestidos/${dressId}`)
            .set(auth())
            .send({
              ...input,
              nombre: "Aurora editada",
              variantes: [
                {
                  ...input.variantes[0],
                  id_variante: variantId,
                  cantidad_stock: 8,
                },
              ],
            });
          assert.equal(r.status, 200, JSON.stringify(r.body));
          assert.equal(r.body.data.variantes[0].id_variante, variantId);
          assert.equal(
            (await request(app).get("/api/vestidos").set(auth())).body.data[0]
              .stock_total,
            8,
          );
        },
      );
      await t.test(
        "cantidades y precios cero/vacíos rechazados en crear y editar",
        async () => {
          const invalid = [
            ...[
              "precio_unitario",
              "precio_cuarta",
              "precio_media_docena",
            ].flatMap((key) =>
              ["0", "0.00", ""].map((value) => ({ ...input, [key]: value })),
            ),
            {
              ...input,
              variantes: [{ color: "Verde", talla: "M", cantidad_stock: 0 }],
            },
            {
              ...input,
              variantes: [{ color: "Verde", talla: "M", cantidad_stock: null }],
            },
            { ...input, numero_vestido: 123 },
          ];
          for (const data of invalid) {
            assert.equal(
              (await request(app).post("/api/vestidos").set(auth()).send(data))
                .status,
              400,
            );
            assert.equal(
              (
                await request(app)
                  .put(`/api/vestidos/${dressId}`)
                  .set(auth())
                  .send(data)
              ).status,
              400,
            );
          }
        },
      );
      await t.test(
        "descuentos opcionales: crear, añadir y quitar",
        async () => {
          for (const discounts of [
            { precio_cuarta: null, precio_media_docena: null },
            { precio_cuarta: "85", precio_media_docena: null },
            { precio_cuarta: null, precio_media_docena: "75" },
            {},
          ]) {
            const { precio_cuarta, precio_media_docena, ...base } = input;
            const r = await request(app)
              .post("/api/vestidos")
              .set(auth())
              .send({ ...base, ...discounts });
            assert.equal(r.status, 201, JSON.stringify(r.body));
            assert.equal(
              r.body.data.precio_cuarta,
              discounts.precio_cuarta ?? null,
            );
            assert.equal(
              r.body.data.precio_media_docena,
              discounts.precio_media_docena ?? null,
            );
            const id = r.body.data.id_vestido;
            const changed = await request(app)
              .put(`/api/vestidos/${id}`)
              .set(auth())
              .send(input);
            assert.equal(changed.status, 200);
            assert.equal(changed.body.data.precio_cuarta, "85");
            const cleared = await request(app)
              .put(`/api/vestidos/${id}`)
              .set(auth())
              .send({
                ...input,
                precio_cuarta: null,
                precio_media_docena: null,
              });
            assert.equal(cleared.status, 200);
            assert.equal(cleared.body.data.precio_cuarta, null);
            await prisma.vestido.delete({ where: { id_vestido: id } });
          }
        },
      );
      await t.test(
        "números automáticos distintos y estables después de editar",
        async () => {
          const original = await prisma.vestido.findUniqueOrThrow({
            where: { id_vestido: dressId },
          });
          assert.ok(original.numero_vestido > 0);
          const created = await Promise.all(
            Array.from({ length: 3 }, () =>
              request(app).post("/api/vestidos").set(auth()).send(input),
            ),
          );
          for (const r of created)
            assert.equal(r.status, 201, JSON.stringify(r.body));
          const numbers = created.map((r) => r.body.data.numero_vestido);
          assert.equal(new Set(numbers).size, 3);
          assert.ok(numbers.every((n) => n > original.numero_vestido));
          const edited = await request(app)
            .put(`/api/vestidos/${dressId}`)
            .set(auth())
            .send({
              ...input,
              nombre: "Aurora editada",
              variantes: [
                {
                  ...input.variantes[0],
                  id_variante: variantId,
                  cantidad_stock: 8,
                },
              ],
            });
          assert.equal(
            edited.body.data.numero_vestido,
            original.numero_vestido,
          );
          for (const r of created)
            await prisma.vestido.delete({
              where: { id_vestido: r.body.data.id_vestido },
            });
        },
      );
      await t.test(
        "variante ajena rechazada sin modificaciones parciales",
        async () => {
          const r = await request(app)
            .put(`/api/vestidos/${dressId}`)
            .set(auth())
            .send({
              ...input,
              variantes: [{ ...input.variantes[0], id_variante: 99999 }],
            });
          assert.equal(r.status, 400);
          assert.equal(
            (
              await prisma.vestido.findUniqueOrThrow({
                where: { id_vestido: dressId },
              })
            ).nombre,
            "Aurora editada",
          );
        },
      );
      await t.test(
        "ubicaciones obligatorias, normalizadas y editables; ubicaciones compartidas",
        async () => {
          for (const value of ["", "A0", "N1", "AA1", "A01", "A-1", null])
            assert.equal(
              (
                await request(app)
                  .post("/api/vestidos")
                  .set(auth())
                  .send({ ...input, ubicacion_almacen: value })
              ).status,
              400,
            );
          const { ubicacion_almacen, ...missing } = input;
          assert.equal(
            (await request(app).post("/api/vestidos").set(auth()).send(missing))
              .status,
            400,
          );
          const r = await request(app)
            .post("/api/vestidos")
            .set(auth())
            .send({ ...input, ubicacion_almacen: " c4 " });
          assert.equal(r.status, 201, JSON.stringify(r.body));
          assert.equal(r.body.data.ubicacion_almacen, "C4");
          const changed = await request(app)
            .put(`/api/vestidos/${r.body.data.id_vestido}`)
            .set(auth())
            .send({ ...input, ubicacion_almacen: "m12" });
          assert.equal(changed.status, 200);
          assert.equal(changed.body.data.ubicacion_almacen, "M12");
          const shared = await request(app)
            .post("/api/vestidos")
            .set(auth())
            .send({ ...input, ubicacion_almacen: "M12" });
          assert.equal(shared.status, 201);
          for (const id of [
            r.body.data.id_vestido,
            shared.body.data.id_vestido,
          ])
            await prisma.vestido.delete({ where: { id_vestido: id } });
        },
      );
      await t.test(
        "precios iguales o invertidos rechazados por API y SQL sin cambios parciales",
        async () => {
          const invalid = [
            { precio_cuarta: "95.10" },
            { precio_cuarta: "96" },
            { precio_media_docena: "85" },
            { precio_media_docena: "86" },
            { precio_cuarta: null, precio_media_docena: "95.10" },
          ];
          for (const prices of invalid) {
            const payload = { ...input, ...prices };
            assert.equal(
              (
                await request(app)
                  .post("/api/vestidos")
                  .set(auth())
                  .send(payload)
              ).status,
              400,
            );
            assert.equal(
              (
                await request(app)
                  .put(`/api/vestidos/${dressId}`)
                  .set(auth())
                  .send(payload)
              ).status,
              400,
            );
          }
          await assert.rejects(() =>
            prisma.vestido.update({
              where: { id_vestido: dressId },
              data: { precio_cuarta: "95.10" },
            }),
          );
          const saved = await prisma.vestido.findUniqueOrThrow({
            where: { id_vestido: dressId },
          });
          assert.equal(saved.precio_cuarta?.toString(), "85");
        },
      );
      await t.test(
        "editar ubicación permite conservar una variante agotada; una nueva no empieza en cero",
        async () => {
          await prisma.varianteVestido.update({
            where: { id_variante: variantId },
            data: { cantidad_stock: 0 },
          });
          const payload = {
            ...input,
            ubicacion_almacen: "B2",
            variantes: [
              {
                ...input.variantes[0],
                id_variante: variantId,
                cantidad_stock: 0,
              },
            ],
          };
          const edited = await request(app)
            .put(`/api/vestidos/${dressId}`)
            .set(auth())
            .send(payload);
          assert.equal(edited.status, 200, JSON.stringify(edited.body));
          assert.equal(edited.body.data.variantes[0].cantidad_stock, 0);
          const newZero = {
            ...payload,
            variantes: [
              ...payload.variantes,
              { color: "Nuevo", talla: null, cantidad_stock: 0 },
            ],
          };
          assert.equal(
            (
              await request(app)
                .put(`/api/vestidos/${dressId}`)
                .set(auth())
                .send(newZero)
            ).status,
            400,
          );
        },
      );
      await t.test("eliminar en cascada variantes sin ventas", async () => {
        assert.equal(
          (await request(app).delete(`/api/vestidos/${dressId}`).set(auth()))
            .status,
          200,
        );
        assert.equal(await prisma.varianteVestido.count(), 0);
        assert.equal(
          (await request(app).delete(`/api/vestidos/${dressId}`).set(auth()))
            .status,
          404,
        );
      });
      await t.test(
        "restricciones SQL, correlativo diario y protección de historial",
        async () => {
          const d = await prisma.vestido.create({
            data: { ...input, variantes: { create: input.variantes } },
          });
          const v = await prisma.varianteVestido.findFirstOrThrow({
            where: { id_vestido: d.id_vestido },
          });
          const c = await prisma.cliente.create({
            data: { celular: "70000001" },
          });
          const sale = {
            numero_diario: 1,
            fecha: new Date("2026-10-30T03:59:00Z"),
            id_cliente: c.id_cliente,
            total_prendas: 1,
            tarifa_aplicada: "unitario" as const,
            monto_vestidos: "95.10",
            total_cobrado: "95.10",
            monto_neto: "95.10",
          };
          const s = await prisma.venta.create({
            data: {
              ...sale,
              detalles: {
                create: {
                  id_variante: v.id_variante,
                  cantidad: 1,
                  precio_unitario_aplicado: "95.10",
                },
              },
            },
          });
          await assert.rejects(() =>
            prisma.venta.create({
              data: { ...sale, fecha: new Date("2026-10-30T03:00:00Z") },
            }),
          );
          await prisma.venta.create({
            data: { ...sale, fecha: new Date("2026-10-30T04:00:00Z") },
          }); // Nuevo día en Bolivia.
          assert.equal(
            (
              await request(app)
                .delete(`/api/vestidos/${d.id_vestido}`)
                .set(auth())
            ).status,
            409,
          );
          assert.equal(
            (
              await request(app)
                .put(`/api/vestidos/${d.id_vestido}`)
                .set(auth())
                .send({
                  ...input,
                  variantes: [
                    { color: "Azul", talla: null, cantidad_stock: 1 },
                  ],
                })
            ).status,
            409,
          );
          assert.ok(
            await prisma.varianteVestido.findUnique({
              where: { id_variante: v.id_variante },
            }),
          );
          await assert.rejects(() =>
            prisma.varianteVestido.update({
              where: { id_variante: v.id_variante },
              data: { cantidad_stock: -1 },
            }),
          );
          const move = await prisma.movimientoContabilidad.create({
            data: {
              fecha: new Date(),
              concepto: "Venta",
              tipo: "Ingreso",
              importe: "95.10",
              id_propietario: owner.id_propietario,
              id_venta: s.id_venta,
            },
          });
          await prisma.venta.delete({ where: { id_venta: s.id_venta } });
          assert.equal(
            (
              await prisma.movimientoContabilidad.findUniqueOrThrow({
                where: { id_movimiento: move.id_movimiento },
              })
            ).id_venta,
            null,
          );
        },
      );
      await t.test(
        "dos dispositivos reciben eventos de crear, editar y eliminar",
        async () => {
          assert.equal(
            (await request(app).get("/api/vestidos/events")).status,
            401,
          );
          const http = app.listen(0, "127.0.0.1");
          await new Promise<void>((resolve) => http.once("listening", resolve));
          const address = http.address() as { port: number };
          const cancel = new AbortController();
          try {
            const clients = await Promise.all(
              [0, 1].map(async () => {
                const r = await fetch(
                  `http://127.0.0.1:${address.port}/api/vestidos/events`,
                  { headers: auth(), signal: cancel.signal },
                );
                assert.equal(r.status, 200);
                assert.match(
                  r.headers.get("content-type")!,
                  /text\/event-stream/,
                );
                return r.body!.getReader();
              }),
            );
            const receive = async () => {
              for (const reader of clients) {
                const r = await reader.read();
                assert.equal(r.done, false);
                assert.match(
                  new TextDecoder().decode(r.value),
                  /inventory.changed/,
                );
              }
            };
            await receive(); // Estado inicial, también recupera cambios tras reconectar.
            const created = await request(app)
              .post("/api/vestidos")
              .set(auth())
              .send(input);
            assert.equal(created.status, 201);
            await receive();
            const id = created.body.data.id_vestido;
            assert.equal(
              (
                await request(app)
                  .put(`/api/vestidos/${id}`)
                  .set(auth())
                  .send({ ...input, nombre: "Cambio remoto" })
              ).status,
              200,
            );
            await receive();
            assert.equal(
              (await request(app).delete(`/api/vestidos/${id}`).set(auth()))
                .status,
              200,
            );
            await receive();
          } finally {
            cancel.abort();
            http.closeAllConnections();
            await new Promise<void>((resolve) => http.close(() => resolve()));
          }
        },
      );
      await t.test("usuario desactivado y JSON inválido", async () => {
        const malformed = await request(app)
          .post("/api/auth/login")
          .set("Content-Type", "application/json")
          .send("{");
        assert.equal(malformed.status, 400);
        assert.equal(malformed.body.success, false);
        await prisma.user.update({
          where: { id: user.id },
          data: { active: false },
        });
        assert.equal(
          (await request(app).get("/api/vestidos").set(auth())).status,
          401,
        );
      });
    } finally {
      await prisma.$disconnect();
      await server.stop();
      await db.close();
    }
  },
);
