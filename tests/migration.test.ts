import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migración conserva vestidos existentes y continúa la numeración", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      await readFile(
        "prisma/migrations/202610300001_initial/migration.sql",
        "utf8",
      ),
    );
    await db.exec(`INSERT INTO "Propietarios" (nombre) VALUES ('Ana');
   INSERT INTO "Vestidos" (numero_vestido,nombre,descripcion,precio_unitario,precio_cuarta,precio_media_docena,id_propietario)
   VALUES (77,'Anterior','Registro anterior',0,0,0,1);`);
    await db.exec(
      await readFile(
        "prisma/migrations/202610300002_automatic_dress_number/migration.sql",
        "utf8",
      ),
    );
    const rows = await db.query<{ numero_vestido: number }>(
      `SELECT numero_vestido FROM "Vestidos"`,
    );
    assert.equal(rows.rows[0].numero_vestido, 77);
    const inserted = await db.query<{ numero_vestido: number }>(
      `INSERT INTO "Vestidos" (nombre,descripcion,precio_unitario,precio_cuarta,precio_media_docena,id_propietario) VALUES ('Nuevo','Nuevo',3,2,1,1) RETURNING numero_vestido`,
    );
    assert.equal(inserted.rows[0].numero_vestido, 78);
    await assert.rejects(() =>
      db.exec(
        `UPDATE "Vestidos" SET nombre='Inválido' WHERE numero_vestido=77`,
      ),
    );
    await db.exec(
      `UPDATE "Vestidos" SET precio_unitario=3,precio_cuarta=2,precio_media_docena=1 WHERE numero_vestido=77`,
    );
  } finally {
    await db.close();
  }
});
