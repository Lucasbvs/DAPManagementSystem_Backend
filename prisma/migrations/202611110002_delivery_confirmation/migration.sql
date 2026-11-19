ALTER TABLE "Ventas" ALTER COLUMN estado SET DEFAULT 'Pendiente';
ALTER TABLE "Ventas" ADD COLUMN reemplazo_completo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Detalle_Venta" ADD COLUMN cantidad_cancelada INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Detalle_Venta" ADD CONSTRAINT detalle_cancelada_valida CHECK (cantidad_cancelada >= 0 AND cantidad_cancelada <= cantidad);
ALTER TABLE "Ventas" DROP CONSTRAINT "Ventas_valores_check";
ALTER TABLE "Ventas" ADD CONSTRAINT "Ventas_valores_check" CHECK
 (numero_diario>0 AND (total_prendas>0 OR (estado='Cancelada' AND total_prendas=0))
 AND monto_vestidos>=0 AND monto_devolucion>=0 AND adicional_delivery>=0
 AND (costo_envio IS NULL OR costo_envio>=0) AND costo_delivery>=0
 AND ((tipo='Venta' AND id_venta_origen IS NULL AND total_cobrado>=0 AND monto_devolucion=0)
 OR (tipo='Cambio' AND id_venta_origen IS NOT NULL AND
 ((reemplazo_completo AND total_cobrado>=0)
 OR (NOT reemplazo_completo AND costo_delivery=0 AND adicional_delivery=0
 AND (costo_envio IS NULL OR costo_envio=0) AND total_cobrado=monto_vestidos-monto_devolucion AND monto_neto=total_cobrado)))));
