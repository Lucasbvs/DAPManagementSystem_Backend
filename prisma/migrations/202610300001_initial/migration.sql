-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Tarifa" AS ENUM ('unitario', 'cuarta', 'media_docena');

-- CreateEnum
CREATE TYPE "Departamento" AS ENUM ('La Paz', 'Cochabamba', 'Santa Cruz', 'Oruro', 'Potosí', 'Tarija', 'Chuquisaca', 'Beni', 'Pando');

-- CreateEnum
CREATE TYPE "EstadoVenta" AS ENUM ('Realizada', 'Cancelada');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('Ingreso', 'Costo', 'Gasto');

-- CreateTable
CREATE TABLE "Users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Propietarios" (
    "id_propietario" SERIAL NOT NULL,
    "nombre" VARCHAR(50) NOT NULL,
    "telefono" VARCHAR(15),

    CONSTRAINT "Propietarios_pkey" PRIMARY KEY ("id_propietario")
);

-- CreateTable
CREATE TABLE "Vestidos" (
    "id_vestido" SERIAL NOT NULL,
    "numero_vestido" INTEGER NOT NULL,
    "nombre" VARCHAR(50) NOT NULL,
    "descripcion" VARCHAR(150) NOT NULL,
    "precio_unitario" DECIMAL(10,2) NOT NULL,
    "precio_cuarta" DECIMAL(10,2) NOT NULL,
    "precio_media_docena" DECIMAL(10,2) NOT NULL,
    "id_propietario" INTEGER NOT NULL,

    CONSTRAINT "Vestidos_pkey" PRIMARY KEY ("id_vestido")
);

-- CreateTable
CREATE TABLE "Variantes_Vestido" (
    "id_variante" SERIAL NOT NULL,
    "id_vestido" INTEGER NOT NULL,
    "color" VARCHAR(30) NOT NULL,
    "talla" VARCHAR(10),
    "cantidad_stock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Variantes_Vestido_pkey" PRIMARY KEY ("id_variante")
);

-- CreateTable
CREATE TABLE "Clientes" (
    "id_cliente" SERIAL NOT NULL,
    "celular" VARCHAR(15) NOT NULL,
    "nombre" VARCHAR(100),
    "direccion_entrega" VARCHAR(255),
    "link_ubicacion" TEXT,

    CONSTRAINT "Clientes_pkey" PRIMARY KEY ("id_cliente")
);

-- CreateTable
CREATE TABLE "Ventas" (
    "id_venta" SERIAL NOT NULL,
    "numero_diario" INTEGER NOT NULL,
    "fecha" TIMESTAMPTZ(3) NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "total_prendas" INTEGER NOT NULL,
    "tarifa_aplicada" "Tarifa" NOT NULL,
    "monto_vestidos" DECIMAL(10,2) NOT NULL,
    "adicional_delivery" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "departamento_destino" "Departamento",
    "ciudad_provincia" VARCHAR(100),
    "costo_envio" DECIMAL(10,2),
    "total_cobrado" DECIMAL(10,2) NOT NULL,
    "monto_neto" DECIMAL(10,2) NOT NULL,
    "estado" "EstadoVenta" NOT NULL DEFAULT 'Realizada',

    CONSTRAINT "Ventas_pkey" PRIMARY KEY ("id_venta")
);

-- CreateTable
CREATE TABLE "Detalle_Venta" (
    "id_detalle" SERIAL NOT NULL,
    "id_venta" INTEGER NOT NULL,
    "id_variante" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario_aplicado" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "Detalle_Venta_pkey" PRIMARY KEY ("id_detalle")
);

-- CreateTable
CREATE TABLE "Movimientos_Contabilidad" (
    "id_movimiento" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "concepto" VARCHAR(150) NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "importe" DECIMAL(10,2) NOT NULL,
    "id_propietario" INTEGER NOT NULL,
    "id_venta" INTEGER,

    CONSTRAINT "Movimientos_Contabilidad_pkey" PRIMARY KEY ("id_movimiento")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");

-- CreateIndex
CREATE INDEX "Vestidos_id_propietario_idx" ON "Vestidos"("id_propietario");

-- CreateIndex
CREATE INDEX "Variantes_Vestido_id_vestido_idx" ON "Variantes_Vestido"("id_vestido");

-- CreateIndex
CREATE UNIQUE INDEX "Clientes_celular_key" ON "Clientes"("celular");

-- CreateIndex
CREATE INDEX "Ventas_id_cliente_idx" ON "Ventas"("id_cliente");

-- CreateIndex
CREATE INDEX "Ventas_fecha_idx" ON "Ventas"("fecha");

-- CreateIndex
CREATE INDEX "Detalle_Venta_id_venta_idx" ON "Detalle_Venta"("id_venta");

-- CreateIndex
CREATE INDEX "Detalle_Venta_id_variante_idx" ON "Detalle_Venta"("id_variante");

-- CreateIndex
CREATE INDEX "Movimientos_Contabilidad_id_propietario_idx" ON "Movimientos_Contabilidad"("id_propietario");

-- CreateIndex
CREATE INDEX "Movimientos_Contabilidad_id_venta_idx" ON "Movimientos_Contabilidad"("id_venta");

-- AddForeignKey
ALTER TABLE "Vestidos" ADD CONSTRAINT "Vestidos_id_propietario_fkey" FOREIGN KEY ("id_propietario") REFERENCES "Propietarios"("id_propietario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variantes_Vestido" ADD CONSTRAINT "Variantes_Vestido_id_vestido_fkey" FOREIGN KEY ("id_vestido") REFERENCES "Vestidos"("id_vestido") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ventas" ADD CONSTRAINT "Ventas_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "Clientes"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detalle_Venta" ADD CONSTRAINT "Detalle_Venta_id_venta_fkey" FOREIGN KEY ("id_venta") REFERENCES "Ventas"("id_venta") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detalle_Venta" ADD CONSTRAINT "Detalle_Venta_id_variante_fkey" FOREIGN KEY ("id_variante") REFERENCES "Variantes_Vestido"("id_variante") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimientos_Contabilidad" ADD CONSTRAINT "Movimientos_Contabilidad_id_propietario_fkey" FOREIGN KEY ("id_propietario") REFERENCES "Propietarios"("id_propietario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimientos_Contabilidad" ADD CONSTRAINT "Movimientos_Contabilidad_id_venta_fkey" FOREIGN KEY ("id_venta") REFERENCES "Ventas"("id_venta") ON DELETE SET NULL ON UPDATE CASCADE;


-- Día comercial en Bolivia, independiente de la zona horaria de cada conexión.
CREATE UNIQUE INDEX "Ventas_fecha_numero_diario_key"
ON "Ventas" (((fecha AT TIME ZONE 'America/La_Paz')::date), numero_diario);
-- Normaliza mayúsculas y ausencia de talla para impedir variantes duplicadas.
CREATE UNIQUE INDEX "Variantes_color_talla_key" ON "Variantes_Vestido"
(id_vestido, lower(trim(color)), lower(coalesce(nullif(trim(talla), ''), '')));
ALTER TABLE "Vestidos" ADD CONSTRAINT "Vestidos_valores_check" CHECK
(numero_vestido > 0 AND precio_unitario >= 0 AND precio_cuarta >= 0 AND precio_media_docena >= 0
AND length(trim(nombre)) > 0 AND length(trim(descripcion)) > 0);
ALTER TABLE "Variantes_Vestido" ADD CONSTRAINT "Variantes_stock_check"
CHECK (cantidad_stock >= 0 AND length(trim(color)) > 0);
ALTER TABLE "Ventas" ADD CONSTRAINT "Ventas_valores_check" CHECK
(numero_diario > 0 AND total_prendas > 0 AND monto_vestidos >= 0 AND adicional_delivery >= 0
AND (costo_envio IS NULL OR costo_envio >= 0) AND total_cobrado >= 0 AND monto_neto >= 0);
ALTER TABLE "Detalle_Venta" ADD CONSTRAINT "Detalle_valores_check" CHECK (cantidad > 0 AND precio_unitario_aplicado >= 0);
ALTER TABLE "Movimientos_Contabilidad" ADD CONSTRAINT "Movimientos_importe_check" CHECK (importe >= 0);
COMMENT ON TABLE "Users" IS 'Usuarios autorizados para administrar el sistema.';
COMMENT ON COLUMN "Users"."id" IS 'Identificador del usuario.';
COMMENT ON COLUMN "Users"."email" IS 'Correo único de acceso.';
COMMENT ON COLUMN "Users"."name" IS 'Nombre visible.';
COMMENT ON COLUMN "Users"."password_hash" IS 'Hash bcrypt; nunca almacenar contraseñas en texto plano.';
COMMENT ON COLUMN "Users"."active" IS 'Permite revocar el acceso del usuario.';
COMMENT ON COLUMN "Users"."created_at" IS 'Fecha de creación del usuario.';
COMMENT ON TABLE "Propietarios" IS 'Titulares de prendas y movimientos: Ana y Dylan.';
COMMENT ON COLUMN "Propietarios"."id_propietario" IS 'Identificador autoincremental.';
COMMENT ON COLUMN "Propietarios"."nombre" IS 'Nombre del propietario.';
COMMENT ON COLUMN "Propietarios"."telefono" IS 'Teléfono opcional.';
COMMENT ON TABLE "Vestidos" IS 'Modelos del catálogo; no almacena stock agregado.';
COMMENT ON COLUMN "Vestidos"."id_vestido" IS 'Identificador interno autoincremental.';
COMMENT ON COLUMN "Vestidos"."numero_vestido" IS 'Número visible del modelo; no se ha impuesto unicidad no solicitada.';
COMMENT ON COLUMN "Vestidos"."nombre" IS 'Nombre comercial.';
COMMENT ON COLUMN "Vestidos"."descripcion" IS 'Descripción de hasta 150 caracteres.';
COMMENT ON COLUMN "Vestidos"."precio_unitario" IS 'Precio por prenda para pedidos de 1 a 2 unidades.';
COMMENT ON COLUMN "Vestidos"."precio_cuarta" IS 'Precio por prenda para pedidos de 3 a 5 unidades.';
COMMENT ON COLUMN "Vestidos"."precio_media_docena" IS 'Precio por prenda para pedidos de 6 o más unidades.';
COMMENT ON COLUMN "Vestidos"."id_propietario" IS 'Propietario obligatorio; eliminación restringida.';
COMMENT ON TABLE "Variantes_Vestido" IS 'Existencias por color y talla de cada modelo.';
COMMENT ON COLUMN "Variantes_Vestido"."id_variante" IS 'Identificador autoincremental.';
COMMENT ON COLUMN "Variantes_Vestido"."id_vestido" IS 'Modelo; al eliminarlo se eliminan variantes sin ventas.';
COMMENT ON COLUMN "Variantes_Vestido"."color" IS 'Color de la variante.';
COMMENT ON COLUMN "Variantes_Vestido"."talla" IS 'Talla opcional.';
COMMENT ON COLUMN "Variantes_Vestido"."cantidad_stock" IS 'Existencias no negativas. Su suma produce el stock total.';
COMMENT ON TABLE "Clientes" IS 'Clientes para la futura etapa de ventas.';
COMMENT ON COLUMN "Clientes"."id_cliente" IS 'Identificador autoincremental.';
COMMENT ON COLUMN "Clientes"."celular" IS 'Número único obligatorio.';
COMMENT ON COLUMN "Clientes"."nombre" IS 'Nombre opcional.';
COMMENT ON COLUMN "Clientes"."direccion_entrega" IS 'Dirección opcional para entrega.';
COMMENT ON COLUMN "Clientes"."link_ubicacion" IS 'Enlace opcional de ubicación.';
COMMENT ON TABLE "Ventas" IS 'Cabecera de venta. Lógica de ventas pendiente de una próxima etapa.';
COMMENT ON COLUMN "Ventas"."id_venta" IS 'Identificador global.';
COMMENT ON COLUMN "Ventas"."numero_diario" IS 'Correlativo único por fecha boliviana; asignar dentro de transacción con bloqueo.';
COMMENT ON COLUMN "Ventas"."fecha" IS 'Instante con zona horaria; día comercial calculado en America/La_Paz.';
COMMENT ON COLUMN "Ventas"."id_cliente" IS 'Cliente obligatorio; referencia protegida.';
COMMENT ON COLUMN "Ventas"."total_prendas" IS 'Suma de las cantidades de los detalles.';
COMMENT ON COLUMN "Ventas"."tarifa_aplicada" IS 'Tarifa por cantidad total del pedido.';
COMMENT ON COLUMN "Ventas"."monto_vestidos" IS 'Subtotal de prendas.';
COMMENT ON COLUMN "Ventas"."adicional_delivery" IS 'Adicional de delivery local; independiente del envío departamental.';
COMMENT ON COLUMN "Ventas"."departamento_destino" IS 'Departamento opcional.';
COMMENT ON COLUMN "Ventas"."ciudad_provincia" IS 'Ciudad o provincia de destino opcional.';
COMMENT ON COLUMN "Ventas"."costo_envio" IS 'Costo opcional de envío departamental.';
COMMENT ON COLUMN "Ventas"."total_cobrado" IS 'Total efectivamente cobrado.';
COMMENT ON COLUMN "Ventas"."monto_neto" IS 'Neto calculado por reglas comerciales de ventas.';
COMMENT ON COLUMN "Ventas"."estado" IS 'Realizada o Cancelada; cancelar no significa eliminar el historial.';
COMMENT ON TABLE "Detalle_Venta" IS 'Prendas por variante y precio histórico de venta.';
COMMENT ON COLUMN "Detalle_Venta"."id_detalle" IS 'Identificador autoincremental.';
COMMENT ON COLUMN "Detalle_Venta"."id_venta" IS 'Venta padre; borrado en cascada solicitado.';
COMMENT ON COLUMN "Detalle_Venta"."id_variante" IS 'Variante vendida; impide borrar variantes con historial.';
COMMENT ON COLUMN "Detalle_Venta"."cantidad" IS 'Cantidad positiva vendida.';
COMMENT ON COLUMN "Detalle_Venta"."precio_unitario_aplicado" IS 'Precio unitario histórico, independiente de cambios del catálogo.';
COMMENT ON TABLE "Movimientos_Contabilidad" IS 'Ingresos, costos y gastos separados por propietario.';
COMMENT ON COLUMN "Movimientos_Contabilidad"."id_movimiento" IS 'Identificador autoincremental.';
COMMENT ON COLUMN "Movimientos_Contabilidad"."fecha" IS 'Fecha del movimiento.';
COMMENT ON COLUMN "Movimientos_Contabilidad"."concepto" IS 'Descripción del movimiento.';
COMMENT ON COLUMN "Movimientos_Contabilidad"."tipo" IS 'Ingreso, Costo o Gasto.';
COMMENT ON COLUMN "Movimientos_Contabilidad"."importe" IS 'Importe no negativo.';
COMMENT ON COLUMN "Movimientos_Contabilidad"."id_propietario" IS 'Titular obligatorio del movimiento.';
COMMENT ON COLUMN "Movimientos_Contabilidad"."id_venta" IS 'Venta opcional; queda NULL si se elimina la venta.';
