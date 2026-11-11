import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migración de almacén conserva datos y precios anteriores; SQL manual instala el mismo esquema", async () => {
  const db = await PGlite.create();
  try {
    const dirs = (await readdir("prisma/migrations", { withFileTypes: true }))
      .filter((x) => x.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs.filter(
      (x) => x.name < "202611050001_inventory_location_prices",
    ))
      await db.exec(
        await readFile(`prisma/migrations/${d.name}/migration.sql`, "utf8"),
      );
    await db.exec(
      `INSERT INTO "Propietarios" (nombre) VALUES ('Ana'); INSERT INTO "Vestidos" (nombre,descripcion,precio_unitario,precio_cuarta,precio_media_docena,id_propietario) VALUES ('Anterior','Datos existentes',100,110,120,1);`,
    );
    await db.exec(
      await readFile(
        "prisma/migrations/202611050001_inventory_location_prices/migration.sql",
        "utf8",
      ),
    );
    const result = await db.query(
      `SELECT nombre,ubicacion_almacen,precio_cuarta::text FROM "Vestidos"`,
    );
    assert.deepEqual(result.rows, [
      { nombre: "Anterior", ubicacion_almacen: null, precio_cuarta: "110.00" },
    ]);
    await assert.rejects(() =>
      db.exec(`UPDATE "Vestidos" SET ubicacion_almacen='A1'`),
    ); // Se deben corregir precios previos antes de editar.
    await db.exec(
      `UPDATE "Vestidos" SET ubicacion_almacen='M12',precio_cuarta=90,precio_media_docena=80`,
    );
    await assert.rejects(() =>
      db.exec(`UPDATE "Vestidos" SET ubicacion_almacen='N1'`),
    );
  } finally {
    await db.close();
  }
  const manual = await PGlite.create();
  try {
    await manual.exec(await readFile("database/01_schema_pgadmin.sql", "utf8"));
    const cols = await manual.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='Vestidos' AND column_name='ubicacion_almacen'`,
    );
    assert.equal(cols.rows.length, 1);
  } finally {
    await manual.close();
  }
});
