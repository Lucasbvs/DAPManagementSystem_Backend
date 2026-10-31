-- Los descuentos ausentes son NULL; los precios informados siguen siendo positivos.
ALTER TABLE "Vestidos" ALTER COLUMN precio_cuarta DROP NOT NULL;
ALTER TABLE "Vestidos" ALTER COLUMN precio_media_docena DROP NOT NULL;
COMMENT ON COLUMN "Vestidos".precio_cuarta IS 'Precio por unidad en cuarta; NULL indica que no ofrece esta tarifa.';
COMMENT ON COLUMN "Vestidos".precio_media_docena IS 'Precio por unidad en media docena; NULL indica que no ofrece esta tarifa.';
