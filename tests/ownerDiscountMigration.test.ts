import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migración de rebajas conserva las ventas existentes y restringe descuentos inválidos", async () => {
  const db = await PGlite.create();
  try {
    const migration = "202611190002_owner_discounts";
    for (const entry of (
      await readdir("prisma/migrations", { withFileTypes: true })
    )
      .filter((d) => d.isDirectory() && d.name < migration)
      .sort((a, b) => a.name.localeCompare(b.name)))
      await db.exec(
        await readFile(`prisma/migrations/${entry.name}/migration.sql`, "utf8"),
      );
    await db.exec(`INSERT INTO "Propietarios" (nombre) VALUES ('Ana');
      INSERT INTO "Vestidos" (nombre,descripcion,ubicacion_almacen,precio_unitario,id_propietario) VALUES ('Vestido','Test','A1',100,1);
      INSERT INTO "Variantes_Vestido" (id_vestido,color,cantidad_stock) VALUES (1,'Verde',5);
      INSERT INTO "Clientes" (celular) VALUES ('70000001');
      INSERT INTO "Ventas" (numero_diario,fecha,id_cliente,total_prendas,tarifa_aplicada,monto_vestidos,total_cobrado,monto_neto) VALUES (1,now(),1,2,'unitario',200,200,190);
      INSERT INTO "Detalle_Venta" (id_venta,id_variante,cantidad,precio_unitario_aplicado) VALUES (1,1,2,100);`);
    await db.exec(
      await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"),
    );
    const result = await db.query(
      `SELECT total_cobrado::text,precio_unitario_aplicado::text,descuento_manual::text FROM "Ventas" JOIN "Detalle_Venta" USING(id_venta)`,
    );
    assert.deepEqual(result.rows, [
      {
        total_cobrado: "200.00",
        precio_unitario_aplicado: "100.00",
        descuento_manual: "0.00",
      },
    ]);
    for (const value of [-1, 201])
      await assert.rejects(() =>
        db.exec(`UPDATE "Detalle_Venta" SET descuento_manual=${value}`),
      );
    await db.exec(`UPDATE "Detalle_Venta" SET descuento_manual=200`);
  } finally {
    await db.close();
  }
});
