import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.service.js";
import { nextSaleNumber } from "./saleNumber.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../utils/AppError.js";
import {
  applyOwnerAmounts,
  lineAmount,
  lineDiscount,
} from "./salePricing.service.js";
import type {
  VentaInput,
  CambioInput,
  EntregaInput,
} from "../validators/venta.schema.js";
export const includeSale = {
  cliente: true,
  venta_origen: {
    select: { id_venta: true, numero_diario: true, fecha: true },
  },
  cambios: { select: { id_venta: true, estado: true } },
  detalles: {
    include: {
      variante: { include: { vestido: { include: { propietario: true } } } },
      devoluciones: {
        where: { venta: { estado: { not: "Cancelada" as const } } },
        select: { cantidad: true },
      },
    },
    orderBy: { id_detalle: "asc" as const },
  },
};
export const boliviaDay = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export function dayRange(day: string) {
  const start = new Date(`${day}T00:00:00-04:00`);
  return { gte: start, lt: new Date(start.getTime() + 86400000) };
}
export const listSales = (day: string, owner?: number) =>
  prisma.venta
    .findMany({
      where: {
        fecha: dayRange(day),
        ...(owner
          ? {
              detalles: {
                some: {
                  OR: [
                    { id_propietario_venta: owner },
                    {
                      id_propietario_venta: null,
                      variante: { vestido: { id_propietario: owner } },
                    },
                  ],
                },
              },
            }
          : {}),
      },
      include: includeSale,
      orderBy: [{ numero_diario: "desc" }],
    })
    .then((rows) =>
      rows.sort(
        (a, b) =>
          Number(a.estado === "Cancelada") - Number(b.estado === "Cancelada"),
      ),
    );
const decimal = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
export const tariffFor = (n: number): "unitario" | "cuarta" | "media_docena" =>
  n >= 6 ? "media_docena" : n >= 3 ? "cuarta" : "unitario";
export function priceFor(
  d: {
    precio_unitario: Prisma.Decimal;
    precio_cuarta: Prisma.Decimal | null;
    precio_media_docena: Prisma.Decimal | null;
  },
  n: number,
) {
  return (
    (n >= 6 ? d.precio_media_docena : n >= 3 ? d.precio_cuarta : null) ??
    d.precio_unitario
  );
}
type SaleAttempt = { id: string; stage: string; day?: string; number?: number };

function logSaleFailure(
  error: unknown,
  context: SaleAttempt,
  attempt: number,
  retry: boolean,
) {
  if (process.env.NODE_ENV === "test") return;
  const failure = error as {
    code?: string;
    name?: string;
    meta?: {
      modelName?: string;
      target?: unknown;
      driverAdapterError?: { cause?: unknown };
    };
    cause?: unknown;
  };
  const cause = (failure?.meta?.driverAdapterError?.cause ?? failure?.cause) as
    | {
        originalCode?: string;
        kind?: string;
        constraint?: { fields?: string[]; index?: string };
      }
    | undefined;
  const target = failure?.meta?.target;
  const details = {
    ...context,
    attempt,
    retry,
    error: failure?.name,
    code: failure?.code,
    model: failure?.meta?.modelName,
    target: Array.isArray(target)
      ? target.filter((value) => typeof value === "string")
      : typeof target === "string"
        ? target
        : undefined,
    sqlState: cause?.originalCode,
    databaseError: cause?.kind,
    constraintFields: cause?.constraint?.fields,
    constraintIndex: cause?.constraint?.index,
  };
  if (retry) console.warn("[ventas] Reintentando registro", details);
  else console.error("[ventas] Falló el registro", details);
}

// Serializable + decremento condicional: ninguna venta puede consumir stock ajeno.
async function transaction<T>(
  run: (tx: Prisma.TransactionClient, attempt: number) => Promise<T>,
  diagnostics?: SaleAttempt,
): Promise<T> {
  for (let attempt = 0; ; attempt++)
    try {
      if (diagnostics) {
        diagnostics.stage = "abrir transacción";
        diagnostics.day = undefined;
        diagnostics.number = undefined;
      }
      return await prisma.$transaction((tx) => run(tx, attempt + 1), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      const retry = attempt < 3 && (code === "P2034" || code === "P2002");
      if (diagnostics) logSaleFailure(e, diagnostics, attempt + 1, retry);
      if (retry) continue;
      throw e;
    }
}
export async function saveSale(input: VentaInput, id?: number) {
  const diagnostics: SaleAttempt | undefined = id
    ? undefined
    : { id: randomUUID(), stage: "abrir transacción" };
  return transaction(async (tx, attempt) => {
    if (diagnostics) diagnostics.stage = "verificar registro previo";
    const old = id
      ? await tx.venta.findUnique({
          where: { id_venta: id },
          include: includeSale,
        })
      : null;
    if (id && !old) throw new AppError(404, "NOT_FOUND", "Venta no encontrada");
    if (old && (old.tipo === "Cambio" || old.cambios.length))
      throw new AppError(
        409,
        "EXCHANGE_HISTORY",
        "Este pedido tiene historial de cambios. Registra otro cambio para conservarlo",
      );
    if (old && (old.estado !== "Pendiente" || old.version !== input.version))
      throw new AppError(
        409,
        "SALE_CHANGED",
        "La venta cambió o fue cancelada. Recarga antes de editar",
      );
    if (!id) {
      const existing = await tx.venta.findUnique({
        where: { clave_registro: input.clave_registro },
        include: includeSale,
      });
      if (existing) {
        if (existing.tipo !== "Venta")
          throw new AppError(
            409,
            "DUPLICATE",
            "La clave ya corresponde a otro pedido",
          );
        return existing;
      }
    }
    if (old) {
      for (const item of old.detalles)
        await tx.varianteVestido.update({
          where: { id_variante: item.id_variante },
          data: { cantidad_stock: { increment: item.cantidad } },
        });
    }
    const total = input.detalles.reduce((n, d) => n + d.cantidad, 0);
    if (diagnostics) diagnostics.stage = "actualizar inventario";
    const variants = await tx.varianteVestido.findMany({
      where: { id_variante: { in: input.detalles.map((d) => d.id_variante) } },
      include: { vestido: { include: { propietario: true } } },
    });
    let subtotal = decimal(0);
    const lines = [];
    for (const line of [...input.detalles].sort(
      (a, b) => a.id_variante - b.id_variante,
    )) {
      const v = variants.find((x) => x.id_variante === line.id_variante);
      if (!v)
        throw new AppError(
          409,
          "VARIANT_REMOVED",
          "Una variante ya no existe. Actualiza el catálogo",
        );
      const previous = old?.detalles.find(
        (d) => d.id_variante === v.id_variante,
      );
      const archived = !v.activo || !v.vestido.activo;
      // Permite gestionar pedidos previos, pero no vender más prendas archivadas.
      if (archived && (!previous || line.cantidad > previous.cantidad))
        throw new AppError(
          409,
          "VARIANT_ARCHIVED",
          "El vestido está archivado. Actualiza el catálogo para elegir otra prenda",
        );
      const stock = await tx.varianteVestido.updateMany({
        where: {
          id_variante: v.id_variante,
          cantidad_stock: { gte: line.cantidad },
        },
        data: { cantidad_stock: { decrement: line.cantidad } },
      });
      if (!stock.count)
        throw new AppError(
          409,
          "INSUFFICIENT_STOCK",
          `Stock insuficiente: ${v.vestido.nombre} / ${v.color}`,
        );
      // Conserva precio histórico si la variante y el tramo de cantidad no cambian.
      const price =
        previous && (archived || old?.tarifa_aplicada === tariffFor(total))
          ? previous.precio_unitario_aplicado
          : priceFor(v.vestido, total);
      subtotal = subtotal.plus(price.mul(line.cantidad));
      lines.push({
        ...line,
        precio_unitario_aplicado: price,
        descuento_manual:
          previous &&
          previous.cantidad === line.cantidad &&
          old?.tarifa_aplicada === tariffFor(total)
            ? previous.descuento_manual
            : decimal(0),
        nombre_vestido: previous?.nombre_vestido ?? v.vestido.nombre,
        color: previous?.color ?? v.color,
        talla: previous?.talla ?? v.talla,
        id_propietario_venta:
          previous?.id_propietario_venta ?? v.vestido.id_propietario,
        propietario_nombre:
          previous?.propietario_nombre ?? v.vestido.propietario.nombre,
        ubicacion_almacen: v.vestido.ubicacion_almacen,
      });
    }
    if (subtotal.greaterThan("99999999.99"))
      throw new AppError(
        400,
        "INVALID_TOTAL",
        "El subtotal de prendas no debe exceder Bs 99.999.999,99",
      );
    applyOwnerAmounts(lines, input.importes_propietario);
    subtotal = lines.reduce(
      (sum, line) => sum.plus(lineAmount(line, line.cantidad)),
      decimal(0),
    );
    const delivery = old?.costo_delivery ?? decimal(10),
      additional = decimal(input.adicional_delivery),
      shipping = decimal(input.costo_envio ?? 0);
    const charged = subtotal.plus(additional).plus(shipping),
      net = subtotal.minus(delivery);
    if (charged.greaterThan("99999999.99"))
      throw new AppError(
        400,
        "INVALID_TOTAL",
        "El total no debe exceder Bs 99.999.999,99",
      );
    if (diagnostics) diagnostics.stage = "guardar cliente";
    const client = await tx.cliente.upsert({
      where: { celular: input.cliente.celular },
      create: input.cliente,
      update: input.cliente,
    });
    const data = {
      hora_entrega_desde: input.hora_entrega_desde,
      hora_entrega_hasta: input.hora_entrega_hasta,
      id_cliente: client.id_cliente,
      cliente_nombre: input.cliente.nombre,
      cliente_celular: input.cliente.celular,
      direccion_entrega: input.cliente.direccion_entrega,
      link_ubicacion: input.cliente.link_ubicacion,
      total_prendas: total,
      tarifa_aplicada: tariffFor(total),
      monto_vestidos: subtotal,
      adicional_delivery: additional,
      departamento_destino: input.departamento_destino,
      ciudad_provincia: input.ciudad_provincia,
      forma_pago: input.forma_pago,
      costo_envio: input.costo_envio === null ? null : shipping,
      total_cobrado: charged,
      monto_neto: net,
      costo_delivery: delivery,
    };
    if (old) {
      const changed = await tx.venta.updateMany({
        where: { id_venta: id, version: input.version, estado: "Pendiente" },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count)
        throw new AppError(
          409,
          "SALE_CHANGED",
          "La venta cambió. Recarga antes de editar",
        );
      await tx.detalleVenta.deleteMany({ where: { id_venta: id } });
      await tx.detalleVenta.createMany({
        data: lines.map((l) => ({ ...l, id_venta: old.id_venta })),
      });
      return tx.venta.findUniqueOrThrow({
        where: { id_venta: id },
        include: includeSale,
      });
    }
    const now = new Date();
    if (diagnostics) {
      diagnostics.stage = "consultar numeración";
      diagnostics.day = boliviaDay(now);
    }
    const number = await nextSaleNumber(tx, now);
    if (diagnostics) {
      diagnostics.number = number;
      diagnostics.stage = "insertar venta y detalles";
      if (process.env.NODE_ENV !== "test")
        console.info("[ventas] Correlativo calculado", {
          ...diagnostics,
          attempt,
        });
    }
    const sale = await tx.venta.create({
      data: {
        ...data,
        estado: "Pendiente",
        clave_registro: input.clave_registro,
        fecha: now,
        numero_diario: number,
        detalles: { create: lines },
      },
      include: includeSale,
    });
    if (diagnostics) diagnostics.stage = "confirmar transacción";
    return sale;
  }, diagnostics);
}
export async function cancelSale(id: number, version: number) {
  return transaction(async (tx) => {
    const sale = await tx.venta.findUnique({
      where: { id_venta: id },
      include: includeSale,
    });
    if (!sale) throw new AppError(404, "NOT_FOUND", "Venta no encontrada");
    if (sale.estado === "Cancelada") return sale;
    if (sale.cambios.some((c) => c.estado !== "Cancelada"))
      throw new AppError(
        409,
        "ACTIVE_EXCHANGES",
        "Cancela primero los cambios vinculados a este pedido",
      );
    if (sale.version !== version)
      throw new AppError(
        409,
        "SALE_CHANGED",
        "La venta cambió. Recarga antes de cancelar",
      );
    const changed = await tx.venta.updateMany({
      where: { id_venta: id, version, estado: { not: "Cancelada" } },
      data: { estado: "Cancelada", version: { increment: 1 } },
    });
    if (!changed.count)
      throw new AppError(
        409,
        "SALE_CHANGED",
        "La venta cambió. Recarga antes de cancelar",
      );
    const stock = new Map<number, number>();
    for (const d of sale.detalles)
      stock.set(
        d.id_variante,
        (stock.get(d.id_variante) ?? 0) +
          (d.tipo === "Devolucion"
            ? sale.reemplazo_completo
              ? 0
              : -d.cantidad
            : d.cantidad - d.cantidad_cancelada),
      );
    await adjustStock(tx, stock);
    if (sale.id_venta_origen)
      await tx.venta.update({
        where: { id_venta: sale.id_venta_origen },
        data: { version: { increment: 1 } },
      });
    return tx.venta.findUniqueOrThrow({
      where: { id_venta: id },
      include: includeSale,
    });
  });
}
export async function printableSales(day: string, ids: number[]) {
  const sales = await prisma.venta.findMany({
    where: {
      id_venta: { in: ids },
      fecha: dayRange(day),
      estado: { not: "Cancelada" },
    },
    include: includeSale,
    orderBy: { numero_diario: "asc" },
  });
  if (sales.length !== new Set(ids).size)
    throw new AppError(
      409,
      "INVALID_SELECTION",
      "Selecciona ventas realizadas de la fecha elegida. Alguna cambió o fue cancelada",
    );
  return sales.map((sale) => ({
    ...sale,
    detalles: sale.detalles
      .filter((d) =>
        d.tipo === "Entrega"
          ? d.cantidad > d.cantidad_cancelada
          : !sale.reemplazo_completo,
      )
      .map((d) => ({
        ...d,
        cantidad: d.cantidad - d.cantidad_cancelada,
        descuento_manual: lineDiscount(d, d.cantidad - d.cantidad_cancelada),
      })),
  }));
}

async function adjustStock(
  tx: Prisma.TransactionClient,
  delta: Map<number, number>,
) {
  for (const [id, n] of [...delta.entries()].sort((a, b) => a[0] - b[0])) {
    if (!n) continue;
    const result = await tx.varianteVestido.updateMany({
      where: {
        id_variante: id,
        ...(n < 0 ? { cantidad_stock: { gte: -n } } : {}),
      },
      data: { cantidad_stock: { increment: n } },
    });
    if (!result.count)
      throw new AppError(
        409,
        "INSUFFICIENT_STOCK",
        "No hay stock suficiente para completar o revertir el cambio",
      );
  }
}
export async function exchangeSale(id: number, input: CambioInput) {
  return transaction(async (tx) => {
    const existing = await tx.venta.findUnique({
      where: { clave_registro: input.clave_registro },
      include: includeSale,
    });
    if (existing) {
      if (existing.id_venta_origen !== id || existing.tipo !== "Cambio")
        throw new AppError(
          409,
          "DUPLICATE",
          "La clave ya corresponde a otro pedido",
        );
      return existing;
    }
    const source = await tx.venta.findUnique({
      where: { id_venta: id },
      include: includeSale,
    });
    if (!source) throw new AppError(404, "NOT_FOUND", "Venta no encontrada");
    if (source.estado === "Cancelada" || source.version !== input.version)
      throw new AppError(
        409,
        "SALE_CHANGED",
        "El pedido cambió o fue cancelado. Actualiza antes de registrar el cambio",
      );
    if (source.estado !== "Realizada")
      throw new AppError(
        409,
        "SALE_NOT_DELIVERED",
        "Confirma la entrega antes de cambiar vestidos",
      );
    const stock = new Map<number, number>();
    let returned = decimal(0),
      delivered = decimal(0);
    const lines: Prisma.DetalleVentaUncheckedCreateWithoutVentaInput[] = [];
    for (const item of input.devoluciones) {
      const line = source.detalles.find(
        (d) => d.id_detalle === item.id_detalle && d.tipo === "Entrega",
      );
      if (
        !line ||
        item.cantidad >
          line.cantidad -
            line.cantidad_cancelada -
            line.devoluciones.reduce((n, d) => n + d.cantidad, 0)
      )
        throw new AppError(
          409,
          "INVALID_RETURN",
          "No puedes devolver más prendas de las entregadas o devolverlas dos veces",
        );
      const offset = line.devoluciones.reduce((n, d) => n + d.cantidad, 0);
      returned = returned.plus(lineAmount(line, item.cantidad, offset));
      stock.set(
        line.id_variante,
        (stock.get(line.id_variante) ?? 0) + item.cantidad,
      );
      lines.push({
        tipo: "Devolucion",
        id_detalle_origen: line.id_detalle,
        id_variante: line.id_variante,
        cantidad: item.cantidad,
        precio_unitario_aplicado: line.precio_unitario_aplicado,
        descuento_manual: lineDiscount(line, item.cantidad, offset),
        nombre_vestido: line.nombre_vestido ?? line.variante.vestido.nombre,
        color: line.color ?? line.variante.color,
        talla: line.talla,
        id_propietario_venta:
          line.id_propietario_venta ?? line.variante.vestido.id_propietario,
        propietario_nombre:
          line.propietario_nombre ?? line.variante.vestido.propietario.nombre,
        ubicacion_almacen: line.variante.vestido.ubicacion_almacen,
      });
    }
    let total = input.entregas.reduce((n, d) => n + d.cantidad, 0);
    const variants = await tx.varianteVestido.findMany({
      where: {
        id_variante: { in: input.entregas.map((d) => d.id_variante) },
        activo: true,
        vestido: { activo: true },
      },
      include: { vestido: { include: { propietario: true } } },
    });
    for (const item of input.entregas) {
      const v = variants.find((d) => d.id_variante === item.id_variante);
      if (!v)
        throw new AppError(
          409,
          "VARIANT_REMOVED",
          "Una prenda a entregar ya no existe",
        );
      const price = priceFor(v.vestido, total);
      delivered = delivered.plus(price.mul(item.cantidad));
      stock.set(v.id_variante, (stock.get(v.id_variante) ?? 0) - item.cantidad);
      lines.push({
        tipo: "Entrega",
        id_variante: v.id_variante,
        cantidad: item.cantidad,
        precio_unitario_aplicado: price,
        nombre_vestido: v.vestido.nombre,
        color: v.color,
        talla: v.talla,
        id_propietario_venta: v.vestido.id_propietario,
        propietario_nombre: v.vestido.propietario.nombre,
        ubicacion_almacen: v.vestido.ubicacion_almacen,
      });
    }
    if ([...stock.values()].every((n) => n === 0))
      throw new AppError(
        400,
        "EMPTY_EXCHANGE",
        "Selecciona prendas diferentes para registrar el cambio",
      );
    // Carry forward the garments retained by the customer at their historical prices.
    for (const line of source.detalles.filter((d) => d.tipo === "Entrega")) {
      const returnedNow =
        input.devoluciones.find((d) => d.id_detalle === line.id_detalle)
          ?.cantidad ?? 0;
      const retained =
        line.cantidad -
        line.cantidad_cancelada -
        line.devoluciones.reduce((n, d) => n + d.cantidad, 0) -
        returnedNow;
      if (retained <= 0) continue;
      total += retained;
      const offset =
        line.devoluciones.reduce((n, d) => n + d.cantidad, 0) + returnedNow;
      delivered = delivered.plus(lineAmount(line, retained, offset));
      lines.push({
        tipo: "Entrega",
        id_variante: line.id_variante,
        cantidad: retained,
        precio_unitario_aplicado: line.precio_unitario_aplicado,
        descuento_manual: lineDiscount(line, retained, offset),
        nombre_vestido: line.nombre_vestido,
        color: line.color,
        talla: line.talla,
        id_propietario_venta: line.id_propietario_venta,
        propietario_nombre: line.propietario_nombre,
        ubicacion_almacen: line.ubicacion_almacen,
      });
    }
    const charged = delivered
      .plus(source.adicional_delivery)
      .plus(source.costo_envio ?? 0);
    const net = delivered.minus(source.costo_delivery);
    if (
      charged.greaterThan("99999999.99") ||
      returned.greaterThan("99999999.99")
    )
      throw new AppError(
        400,
        "INVALID_TOTAL",
        "El importe supera el máximo permitido",
      );
    await adjustStock(tx, stock);
    const changed = await tx.venta.updateMany({
      where: {
        id_venta: id,
        version: input.version,
        estado: { not: "Cancelada" },
      },
      data: { estado: "Cancelada", version: { increment: 1 } },
    });
    if (!changed.count)
      throw new AppError(
        409,
        "SALE_CHANGED",
        "El pedido cambió. Actualiza antes de continuar",
      );
    const now = new Date(),
      number = await nextSaleNumber(tx, now);
    return tx.venta.create({
      data: {
        tipo: "Cambio",
        reemplazo_completo: true,
        estado: "Pendiente",
        id_venta_origen: id,
        clave_registro: input.clave_registro,
        numero_diario: number,
        fecha: now,
        hora_entrega_desde: input.hora_entrega_desde,
        hora_entrega_hasta: input.hora_entrega_hasta,
        id_cliente: source.id_cliente,
        cliente_nombre: source.cliente_nombre,
        cliente_celular: source.cliente_celular ?? source.cliente.celular,
        direccion_entrega: source.direccion_entrega,
        link_ubicacion: source.link_ubicacion,
        departamento_destino: source.departamento_destino,
        ciudad_provincia: source.ciudad_provincia,
        total_prendas: total,
        tarifa_aplicada: tariffFor(total),
        monto_vestidos: delivered,
        monto_devolucion: returned,
        total_cobrado: charged,
        monto_neto: net,
        costo_delivery: source.costo_delivery,
        adicional_delivery: source.adicional_delivery,
        forma_pago: source.forma_pago,
        costo_envio: source.costo_envio,
        detalles: { create: lines },
      },
      include: includeSale,
    });
  });
}

async function confirmDeliveryInTransaction(
  tx: Prisma.TransactionClient,
  id: number,
  input: EntregaInput,
) {
  const sale = await tx.venta.findUnique({
    where: { id_venta: id },
    include: includeSale,
  });
  if (!sale) throw new AppError(404, "NOT_FOUND", "Venta no encontrada");
  const lines = sale.detalles.filter((d) => d.tipo === "Entrega");
  if (
    input.entregas.some(
      (item) =>
        !lines.some(
          (d) =>
            d.id_detalle === item.id_detalle && item.cantidad <= d.cantidad,
        ),
    )
  )
    throw new AppError(
      400,
      "INVALID_DELIVERY",
      "Revisa las cantidades de las prendas entregadas",
    );
  const quantities = new Map(
    input.entregas.map((d) => [d.id_detalle, d.cantidad]),
  );
  if (
    input.costo_envio !== undefined &&
    (sale.forma_pago !== "Pagado" || !sale.departamento_destino)
  )
    throw new AppError(
      400,
      "INVALID_SHIPPING",
      "El costo de envío solo se puede ajustar en ventas pagadas con envío",
    );
  const shipping =
    input.costo_envio === undefined
      ? sale.costo_envio
      : decimal(input.costo_envio);
  // Repeating a successful confirmation must not restore stock twice.
  if (sale.estado !== "Pendiente") {
    if (
      sale.version === input.version + 1 &&
      (input.costo_envio === undefined ||
        decimal(sale.costo_envio ?? 0).equals(
          sale.estado === "Cancelada" ? 0 : input.costo_envio,
        )) &&
      lines.every(
        (d) =>
          d.cantidad - d.cantidad_cancelada ===
          (quantities.get(d.id_detalle) ?? 0),
      )
    )
      return sale;
    throw new AppError(
      409,
      "SALE_CHANGED",
      "La entrega ya fue resuelta. Recarga la venta",
    );
  }
  if (sale.version !== input.version)
    throw new AppError(
      409,
      "SALE_CHANGED",
      "La venta cambió. Recarga antes de confirmar",
    );
  let total = 0,
    subtotal = decimal(0);
  const stock = new Map<number, number>();
  for (const line of lines) {
    const delivered = quantities.get(line.id_detalle) ?? 0;
    const cancelled = line.cantidad - delivered;
    total += delivered;
    subtotal = subtotal.plus(lineAmount(line, delivered));
    stock.set(line.id_variante, (stock.get(line.id_variante) ?? 0) + cancelled);
    await tx.detalleVenta.update({
      where: { id_detalle: line.id_detalle },
      data: { cantidad_cancelada: cancelled },
    });
  }
  const charged = total
    ? subtotal.plus(sale.adicional_delivery).plus(shipping ?? 0)
    : decimal(0);
  if (charged.greaterThan("99999999.99"))
    throw new AppError(
      400,
      "INVALID_TOTAL",
      "El total no debe exceder Bs 99.999.999,99",
    );
  const changed = await tx.venta.updateMany({
    where: { id_venta: id, version: input.version, estado: "Pendiente" },
    data: {
      estado: total ? "Realizada" : "Cancelada",
      version: { increment: 1 },
      total_prendas: total,
      monto_vestidos: subtotal,
      costo_envio: shipping,
      total_cobrado: charged,
      monto_neto: total ? subtotal.minus(sale.costo_delivery) : decimal(0),
      ...(!total
        ? {
            costo_delivery: decimal(0),
            adicional_delivery: decimal(0),
            costo_envio: sale.costo_envio === null ? null : decimal(0),
          }
        : {}),
    },
  });
  if (!changed.count)
    throw new AppError(
      409,
      "SALE_CHANGED",
      "La venta cambió. Recarga antes de confirmar",
    );
  await adjustStock(tx, stock);
  return tx.venta.findUniqueOrThrow({
    where: { id_venta: id },
    include: includeSale,
  });
}

export async function confirmDelivery(id: number, input: EntregaInput) {
  return transaction((tx) => confirmDeliveryInTransaction(tx, id, input));
}

export async function confirmDeliveries(
  orders: (EntregaInput & { id_venta: number })[],
) {
  return transaction(async (tx) => {
    const results = [];
    for (const order of [...orders].sort((a, b) => a.id_venta - b.id_venta)) {
      results.push(
        await confirmDeliveryInTransaction(tx, order.id_venta, order),
      );
    }
    return results;
  });
}
