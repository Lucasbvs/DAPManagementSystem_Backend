import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
test("migración de horarios/cambios conserva ventas y stock y completa datos históricos", async () => {
  const db = await PGlite.create();
  try {
    for (const dir of (
      await readdir("prisma/migrations", { withFileTypes: true })
    )
      .filter(
        (d) =>
          d.isDirectory() && d.name < "202611050002_sales_delivery_exchanges",
      )
      .sort((a, b) => a.name.localeCompare(b.name)))
      await db.exec(
        await readFile(`prisma/migrations/${dir.name}/migration.sql`, "utf8"),
      );
    await db.exec(`INSERT INTO "Propietarios" (nombre) VALUES ('Ana');
   INSERT INTO "Vestidos" (nombre,descripcion,ubicacion_almacen,precio_unitario,id_propietario) VALUES ('Aurora','Prenda','M12',100,1);
   INSERT INTO "Variantes_Vestido" (id_vestido,color,cantidad_stock) VALUES (1,'Verde',9);
   INSERT INTO "Clientes" (celular) VALUES ('70000001');
   INSERT INTO "Ventas" (numero_diario,fecha,id_cliente,total_prendas,tarifa_aplicada,monto_vestidos,total_cobrado,monto_neto) VALUES (1,'2026-11-05T12:00:00Z',1,1,'unitario',100,100,90);
   INSERT INTO "Detalle_Venta" (id_venta,id_variante,cantidad,precio_unitario_aplicado) VALUES (1,1,1,100);`);
    await db.exec(
      await readFile(
        "prisma/migrations/202611050002_sales_delivery_exchanges/migration.sql",
        "utf8",
      ),
    );
    const sale = await db.query(
      `SELECT tipo,hora_entrega_desde,hora_entrega_hasta,total_cobrado::text,monto_neto::text FROM "Ventas"`,
    );
    assert.deepEqual(sale.rows, [
      {
        tipo: "Venta",
        hora_entrega_desde: null,
        hora_entrega_hasta: null,
        total_cobrado: "100.00",
        monto_neto: "90.00",
      },
    ]);
    const details = await db.query(
      `SELECT tipo,id_propietario_venta,propietario_nombre,ubicacion_almacen FROM "Detalle_Venta"`,
    );
    assert.deepEqual(details.rows, [
      {
        tipo: "Entrega",
        id_propietario_venta: 1,
        propietario_nombre: "Ana",
        ubicacion_almacen: "M12",
      },
    ]);
    assert.equal(
      (
        await db.query<{ cantidad_stock: number }>(
          `SELECT cantidad_stock FROM "Variantes_Vestido"`,
        )
      ).rows[0].cantidad_stock,
      9,
    );
    await assert.rejects(() =>
      db.exec(
        `UPDATE "Ventas" SET hora_entrega_desde=NULL,hora_entrega_hasta='16:00'`,
      ),
    );
    await assert.rejects(() =>
      db.exec(
        `UPDATE "Ventas" SET hora_entrega_desde='16:00',hora_entrega_hasta='14:00'`,
      ),
    );
  } finally {
    await db.close();
  }
});
