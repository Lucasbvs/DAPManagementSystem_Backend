import { prisma } from "./prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../utils/AppError.js";
import type { VestidoInput } from "../validators/vestido.schema.js";
const include = {
  propietario: true,
  variantes: { orderBy: { id_variante: "asc" as const } },
};
export async function list() {
  const rows = await prisma.vestido.findMany({
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
  return prisma.vestido.create({
    data: { ...data, variantes: { create: variantes } },
    include,
  });
}
export async function update(id: number, input: VestidoInput) {
  return prisma.$transaction(
    async (tx) => {
      const current = await tx.vestido.findUnique({
        where: { id_vestido: id },
        include: { variantes: true },
      });
      if (!current)
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
        where: { id_vestido: id, id_variante: { notIn: retained } },
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
  await prisma.vestido.delete({ where: { id_vestido: id } });
  return { id_vestido: id };
}
export const owners = () =>
  prisma.propietario.findMany({ orderBy: { nombre: "asc" } });
