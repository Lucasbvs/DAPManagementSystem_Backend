import { prisma } from "./prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../utils/AppError.js";
import type { VentaInput } from "../validators/venta.schema.js";
export const includeSale = {
  cliente: true,
  detalles: {
    include: { variante: { include: { vestido: true } } },
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
export const listSales = (day: string) =>
  prisma.venta.findMany({
    where: { fecha: dayRange(day) },
    include: includeSale,
    orderBy: { numero_diario: "desc" },
  });
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
async function transaction<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++)
    try {
      return await prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (attempt < 3 && (code === "P2034" || code === "P2002")) continue;
      throw e;
    }
}
export async function saveSale(input: VentaInput, id?: number) {
  return transaction(async (tx) => {
    const old = id
      ? await tx.venta.findUnique({
          where: { id_venta: id },
          include: includeSale,
        })
      : null;
    if (id && !old) throw new AppError(404, "NOT_FOUND", "Venta no encontrada");
    if (old && (old.estado === "Cancelada" || old.version !== input.version))
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
      if (existing) return existing;
    }
    if (old) {
      for (const item of old.detalles)
        await tx.varianteVestido.update({
          where: { id_variante: item.id_variante },
          data: { cantidad_stock: { increment: item.cantidad } },
        });
    }
    const total = input.detalles.reduce((n, d) => n + d.cantidad, 0);
    const variants = await tx.varianteVestido.findMany({
      where: { id_variante: { in: input.detalles.map((d) => d.id_variante) } },
      include: { vestido: true },
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
      const previous = old?.detalles.find(
        (d) => d.id_variante === v.id_variante,
      );
      const price =
        previous && old?.tarifa_aplicada === tariffFor(total)
          ? previous.precio_unitario_aplicado
          : priceFor(v.vestido, total);
      subtotal = subtotal.plus(price.mul(line.cantidad));
      lines.push({
        ...line,
        precio_unitario_aplicado: price,
        nombre_vestido: v.vestido.nombre,
        color: v.color,
        talla: v.talla,
      });
    }
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
    const client = await tx.cliente.upsert({
      where: { celular: input.cliente.celular },
      create: input.cliente,
      update: input.cliente,
    });
    const data = {
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
      costo_envio: input.costo_envio === null ? null : shipping,
      total_cobrado: charged,
      monto_neto: net,
      costo_delivery: delivery,
    };
    if (old) {
      const changed = await tx.venta.updateMany({
        where: { id_venta: id, version: input.version, estado: "Realizada" },
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
    const now = new Date(),
      last = await tx.venta.findFirst({
        where: { fecha: dayRange(boliviaDay(now)) },
        orderBy: { numero_diario: "desc" },
      });
    return tx.venta.create({
      data: {
        ...data,
        clave_registro: input.clave_registro,
        fecha: now,
        numero_diario: (last?.numero_diario ?? 0) + 1,
        detalles: { create: lines },
      },
      include: includeSale,
    });
  });
}
export async function cancelSale(id: number, version: number) {
  return transaction(async (tx) => {
    const sale = await tx.venta.findUnique({
      where: { id_venta: id },
      include: { detalles: true },
    });
    if (!sale) throw new AppError(404, "NOT_FOUND", "Venta no encontrada");
    if (sale.estado === "Cancelada") return sale;
    if (sale.version !== version)
      throw new AppError(
        409,
        "SALE_CHANGED",
        "La venta cambió. Recarga antes de cancelar",
      );
    const changed = await tx.venta.updateMany({
      where: { id_venta: id, version, estado: "Realizada" },
      data: { estado: "Cancelada", version: { increment: 1 } },
    });
    if (!changed.count)
      throw new AppError(
        409,
        "SALE_CHANGED",
        "La venta cambió. Recarga antes de cancelar",
      );
    for (const d of sale.detalles)
      await tx.varianteVestido.update({
        where: { id_variante: d.id_variante },
        data: { cantidad_stock: { increment: d.cantidad } },
      });
    return tx.venta.findUniqueOrThrow({
      where: { id_venta: id },
      include: includeSale,
    });
  });
}
export async function printableSales(day: string, ids: number[]) {
  const sales = await prisma.venta.findMany({
    where: { id_venta: { in: ids }, fecha: dayRange(day), estado: "Realizada" },
    include: includeSale,
    orderBy: { numero_diario: "asc" },
  });
  if (sales.length !== new Set(ids).size)
    throw new AppError(
      409,
      "INVALID_SELECTION",
      "Selecciona ventas realizadas de la fecha elegida. Alguna cambió o fue cancelada",
    );
  return sales;
}
