CREATE TYPE "FormaPago" AS ENUM ('Pagado', 'Por_pagar');
ALTER TABLE "Ventas" ADD COLUMN "forma_pago" "FormaPago" NOT NULL DEFAULT 'Por_pagar';
UPDATE "Ventas" SET "forma_pago" = 'Pagado' WHERE "costo_envio" IS NOT NULL;
