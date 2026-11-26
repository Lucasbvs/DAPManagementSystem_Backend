ALTER TABLE "Detalle_Venta"
 ADD COLUMN "descuento_manual" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Detalle_Venta" ADD CONSTRAINT "Detalle_descuento_check"
 CHECK (descuento_manual >= 0 AND descuento_manual <= precio_unitario_aplicado * cantidad);
COMMENT ON COLUMN "Detalle_Venta"."descuento_manual" IS
 'Rebaja total de la línea original; se prorratea por cantidad para entregas y devoluciones.';
