import { prisma } from "./prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../utils/AppError.js";
import type { VestidoInput } from "../validators/vestido.schema.js";
const include = {
  propietario: true,
  variantes: {
    where: { activo: true },
    orderBy: { id_variante: "asc" as const },
  },
};
export async function list() {
  const rows = await prisma.vestido.findMany({
    where: { activo: true },
    include,
    orderBy: [{ numero_vestido: "asc" }, { id_vestido: "asc" }],
  });
  return rows.map((v) => ({
    ...v,
    stock_total: v.variantes.reduce((n, x) => n + x.cantidad_stock, 0),
  }));
}
export async function create(input: VestidoInput) {
  if (input.variantes.some((v) => v.id_variante))
    throw new AppError(
      400,
      "INVALID_VARIANT",
      "Un vestido nuevo no acepta IDs de variantes",
    );
  const { variantes, ...data } = input;
  return prisma.$transaction(
    async (tx) => {
      const archived = await tx.vestido.findFirst({
        where: {
          activo: false,
          nombre: { equals: data.nombre.trim(), mode: "insensitive" },
        },
        orderBy: { id_vestido: "asc" },
      });
      if (!archived) {
        const dress = await tx.vestido.create({
          data: { ...data, variantes: { create: variantes } },
          include,
        });
        return { ...dress, reactivado: false };
      }
      // Las variantes históricas conservan sus IDs para ventas y devoluciones.
      // El stock nuevo tiene sus propias variantes y no hereda stock anterior.
      await tx.varianteVestido.updateMany({
        where: { id_vestido: archived.id_vestido },
        data: { activo: false },
      });
      const dress = await tx.vestido.update({
        where: { id_vestido: archived.id_vestido },
        data: { ...data, activo: true, variantes: { create: variantes } },
        include,
      });
      return { ...dress, reactivado: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
export async function update(id: number, input: VestidoInput) {
  return prisma.$transaction(
    async (tx) => {
      const current = await tx.vestido.findUnique({
        where: { id_vestido: id },
        include: { variantes: { where: { activo: true } } },
      });
      if (!current || !current.activo)
        throw new AppError(404, "NOT_FOUND", "Vestido no encontrado");
      const { variantes, ...data } = input;
      const existing = new Set(current.variantes.map((v) => v.id_variante));
      if (variantes.some((v) => v.id_variante && !existing.has(v.id_variante)))
        throw new AppError(
          400,
          "INVALID_VARIANT",
          "La variante no pertenece al vestido",
        );
      const retained = variantes.flatMap((v) =>
        v.id_variante ? [v.id_variante] : [],
      );
      await tx.varianteVestido.deleteMany({
        where: {
          id_vestido: id,
          activo: true,
          id_variante: { notIn: retained },
        },
      });
      for (const v of variantes) {
        const { id_variante, ...values } = v;
        if (id_variante)
          await tx.varianteVestido.update({
            where: { id_variante },
            data: values,
          });
        else
          await tx.varianteVestido.create({
            data: { ...values, id_vestido: id },
          });
      }
      return tx.vestido.update({ where: { id_vestido: id }, data, include });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
export async function remove(id: number) {
  return prisma.$transaction(
    async (tx) => {
      const current = await tx.vestido.findUnique({
        where: { id_vestido: id },
      });
      if (!current)
        throw new AppError(404, "NOT_FOUND", "Vestido no encontrado");
      if (!current.activo) return { id_vestido: id, archivado: true };
      const sales = await tx.detalleVenta.count({
        where: { variante: { id_vestido: id } },
      });
      if (sales) {
        await tx.vestido.update({
          where: { id_vestido: id },
          data: { activo: false },
        });
        return { id_vestido: id, archivado: true };
      }
      await tx.vestido.delete({ where: { id_vestido: id } });
      return { id_vestido: id, archivado: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
export const owners = () =>
  prisma.propietario.findMany({ orderBy: { nombre: "asc" } });
