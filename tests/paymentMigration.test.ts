import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

test("migración de pago conserva importes y clasifica el envío existente", async () => {
  const db = await PGlite.create();
  try {
    const migration = "202611190001_payment_shipping";
    for (const dir of (await readdir("prisma/migrations"))
      .filter((name) => name < migration && !name.endsWith(".toml"))
      .sort())
      await db.exec(
        await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8"),
      );
    await db.exec(`INSERT INTO "Clientes" (celular) VALUES ('70000001');
   INSERT INTO "Ventas" (numero_diario,fecha,id_cliente,total_prendas,tarifa_aplicada,monto_vestidos,total_cobrado,monto_neto,costo_envio)
   VALUES (1,now(),1,1,'unitario',100,120,90,20),(2,now(),1,1,'unitario',100,100,90,NULL);`);
    await db.exec(
      await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"),
    );
    const rows = await db.query(
      `SELECT forma_pago,total_cobrado::text,costo_envio::text FROM "Ventas" ORDER BY numero_diario`,
    );
    assert.deepEqual(rows.rows, [
      { forma_pago: "Pagado", total_cobrado: "120.00", costo_envio: "20.00" },
      { forma_pago: "Por_pagar", total_cobrado: "100.00", costo_envio: null },
    ]);
  } finally {
    await db.close();
  }
});
