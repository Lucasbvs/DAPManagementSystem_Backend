-- No renumera ni elimina registros existentes. La secuencia es segura entre conexiones.
BEGIN;
LOCK TABLE "Vestidos" IN ACCESS EXCLUSIVE MODE;
CREATE SEQUENCE "Vestidos_numero_vestido_seq" AS INTEGER;
ALTER SEQUENCE "Vestidos_numero_vestido_seq" OWNED BY "Vestidos"."numero_vestido";
SELECT setval('"Vestidos_numero_vestido_seq"',
 GREATEST(COALESCE((SELECT MAX(numero_vestido) FROM "Vestidos"),0),1),
 COALESCE((SELECT MAX(numero_vestido) FROM "Vestidos"),0)>0);
ALTER TABLE "Vestidos" ALTER COLUMN "numero_vestido"
 SET DEFAULT nextval('"Vestidos_numero_vestido_seq"');
COMMENT ON COLUMN "Vestidos"."numero_vestido" IS
 'Número automático por secuencia. No editable en API. Puede tener saltos tras eliminaciones o transacciones fallidas.';
-- Conserva registros anteriores con precios cero; exige corregirlos antes de editarlos.
-- NOT VALID evita modificar datos históricos: los INSERT/UPDATE nuevos sí se validan.
ALTER TABLE "Vestidos" ADD CONSTRAINT "Vestidos_precios_positivos_check"
 CHECK (precio_unitario > 0 AND precio_cuarta > 0 AND precio_media_docena > 0) NOT VALID;
COMMIT;
