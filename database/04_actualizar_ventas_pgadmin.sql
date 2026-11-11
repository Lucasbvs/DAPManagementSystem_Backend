-- Solo para base con SQL manual y etapa de ubicaciones ya aplicada. No combinar con Prisma Migrate.
BEGIN;
-- Horarios e historial de cambios sin modificar importes ni detalles anteriores.
CREATE TYPE "TipoVenta" AS ENUM ('Venta','Cambio');
CREATE TYPE "TipoDetalle" AS ENUM ('Entrega','Devolucion');
ALTER TABLE "Ventas" ADD COLUMN "hora_entrega_desde" VARCHAR(5), ADD COLUMN "hora_entrega_hasta" VARCHAR(5),
 ADD COLUMN "tipo" "TipoVenta" NOT NULL DEFAULT 'Venta', ADD COLUMN "id_venta_origen" INTEGER,
 ADD COLUMN "monto_devolucion" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Ventas" ADD CONSTRAINT "Ventas_origen_fkey" FOREIGN KEY ("id_venta_origen") REFERENCES "Ventas"("id_venta") ON DELETE RESTRICT;
CREATE INDEX "Ventas_id_venta_origen_idx" ON "Ventas"("id_venta_origen");
ALTER TABLE "Detalle_Venta" ADD COLUMN "tipo" "TipoDetalle" NOT NULL DEFAULT 'Entrega', ADD COLUMN "id_detalle_origen" INTEGER,
 ADD COLUMN "id_propietario_venta" INTEGER, ADD COLUMN "propietario_nombre" VARCHAR(50), ADD COLUMN "ubicacion_almacen" VARCHAR(20);
ALTER TABLE "Detalle_Venta" ADD CONSTRAINT "Detalle_origen_fkey" FOREIGN KEY ("id_detalle_origen") REFERENCES "Detalle_Venta"("id_detalle") ON DELETE RESTRICT;
CREATE INDEX "Detalle_Venta_id_detalle_origen_idx" ON "Detalle_Venta"("id_detalle_origen");
UPDATE "Detalle_Venta" d SET id_propietario_venta=v.id_propietario, propietario_nombre=p.nombre, ubicacion_almacen=v.ubicacion_almacen
 FROM "Variantes_Vestido" x JOIN "Vestidos" v ON v.id_vestido=x.id_vestido JOIN "Propietarios" p ON p.id_propietario=v.id_propietario
 WHERE d.id_variante=x.id_variante;
ALTER TABLE "Ventas" ADD CONSTRAINT "Ventas_horario_check" CHECK
 ((hora_entrega_desde IS NULL AND hora_entrega_hasta IS NULL) OR
 (hora_entrega_desde IS NOT NULL AND hora_entrega_desde ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
 (hora_entrega_hasta IS NULL OR (hora_entrega_hasta ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND hora_entrega_hasta > hora_entrega_desde))));
ALTER TABLE "Ventas" DROP CONSTRAINT "Ventas_valores_check";
ALTER TABLE "Ventas" ADD CONSTRAINT "Ventas_valores_check" CHECK
 (numero_diario>0 AND total_prendas>0 AND monto_vestidos>=0 AND monto_devolucion>=0 AND adicional_delivery>=0
 AND (costo_envio IS NULL OR costo_envio>=0) AND costo_delivery>=0
 AND ((tipo='Venta' AND id_venta_origen IS NULL AND total_cobrado>=0 AND monto_devolucion=0)
 OR (tipo='Cambio' AND id_venta_origen IS NOT NULL AND costo_delivery=0 AND adicional_delivery=0
 AND (costo_envio IS NULL OR costo_envio=0) AND total_cobrado=monto_vestidos-monto_devolucion AND monto_neto=total_cobrado)));
COMMIT;
