-- SOLO para bases ya creadas manualmente con 01_schema_pgadmin.sql anterior a ventas.
-- No ejecutar si Prisma Migrate ya aplicó 202610310002_sales_snapshots.
BEGIN;
-- Datos históricos independientes de futuras modificaciones al cliente y catálogo.
ALTER TABLE "Ventas" ADD COLUMN "clave_registro" UUID,
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "cliente_nombre" VARCHAR(100), ADD COLUMN "cliente_celular" VARCHAR(15),
 ADD COLUMN "direccion_entrega" VARCHAR(255), ADD COLUMN "link_ubicacion" TEXT,
 ADD COLUMN "costo_delivery" DECIMAL(10,2) NOT NULL DEFAULT 10;
CREATE UNIQUE INDEX "Ventas_clave_registro_key" ON "Ventas"("clave_registro");
ALTER TABLE "Detalle_Venta" ADD COLUMN "nombre_vestido" VARCHAR(50),
 ADD COLUMN "color" VARCHAR(30), ADD COLUMN "talla" VARCHAR(10);
UPDATE "Ventas" v SET cliente_nombre=c.nombre, cliente_celular=c.celular,
 direccion_entrega=c.direccion_entrega, link_ubicacion=c.link_ubicacion
 FROM "Clientes" c WHERE v.id_cliente=c.id_cliente;
UPDATE "Detalle_Venta" d SET nombre_vestido=v.nombre, color=x.color, talla=x.talla
 FROM "Variantes_Vestido" x JOIN "Vestidos" v ON v.id_vestido=x.id_vestido
 WHERE d.id_variante=x.id_variante;

-- Una venta menor al costo fijo puede tener neto negativo; se conserva el valor real.
ALTER TABLE "Ventas" DROP CONSTRAINT "Ventas_valores_check";
ALTER TABLE "Ventas" ADD CONSTRAINT "Ventas_valores_check" CHECK
(numero_diario > 0 AND total_prendas > 0 AND monto_vestidos >= 0 AND adicional_delivery >= 0
AND (costo_envio IS NULL OR costo_envio >= 0) AND total_cobrado >= 0 AND costo_delivery >= 0);

COMMIT;
