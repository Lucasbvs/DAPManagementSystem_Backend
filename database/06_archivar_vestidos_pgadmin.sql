-- Archivar vestidos conserva sus ventas; las variantes antiguas quedan históricas
-- al reactivarlos con los datos y el stock del nuevo formulario.
BEGIN;
ALTER TABLE "Vestidos" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Variantes_Vestido" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "Vestidos_activo_idx" ON "Vestidos"("activo");

DROP INDEX "Variantes_color_talla_key";
CREATE UNIQUE INDEX "Variantes_color_talla_key" ON "Variantes_Vestido"
  (id_vestido, lower(trim(color)), lower(coalesce(nullif(trim(talla), ''), '')))
  WHERE "activo";
COMMIT;
