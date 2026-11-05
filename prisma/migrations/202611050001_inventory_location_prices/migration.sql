-- Ubicación por modelo. No inventar ubicaciones para registros existentes.
ALTER TABLE "Vestidos" ADD COLUMN "ubicacion_almacen" VARCHAR(20);
ALTER TABLE "Vestidos" ADD CONSTRAINT "Vestidos_ubicacion_check"
 CHECK (ubicacion_almacen IS NULL OR ubicacion_almacen ~ '^[A-M][1-9][0-9]{0,17}$');
-- Conserva precios históricos anteriores. Todos los INSERT/UPDATE nuevos sí cumplen la regla.
ALTER TABLE "Vestidos" ADD CONSTRAINT "Vestidos_orden_precios_check" CHECK
 ((precio_cuarta IS NULL OR precio_unitario > precio_cuarta)
 AND (precio_media_docena IS NULL OR precio_unitario > precio_media_docena)
 AND (precio_cuarta IS NULL OR precio_media_docena IS NULL OR precio_cuarta > precio_media_docena)) NOT VALID;
