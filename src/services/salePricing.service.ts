import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../utils/AppError.js";

type PricedLine = {
  cantidad: number;
  precio_unitario_aplicado: Prisma.Decimal;
  descuento_manual: Prisma.Decimal;
};

// Tramos consecutivos: lo devuelto y lo conservado suman exactamente el importe original.
export function lineDiscount(line: PricedLine, quantity: number, offset = 0) {
  const prefix = (n: number) =>
    line.descuento_manual
      .mul(n)
      .div(line.cantidad)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  return prefix(offset + quantity).minus(prefix(offset));
}
export function lineAmount(line: PricedLine, quantity: number, offset = 0) {
  return line.precio_unitario_aplicado
    .mul(quantity)
    .minus(lineDiscount(line, quantity, offset));
}

export function applyOwnerAmounts(
  lines: (PricedLine & { id_propietario_venta: number })[],
  overrides: { id_propietario: number; monto_prendas: string }[] | undefined,
) {
  if (overrides === undefined) return;
  for (const line of lines) line.descuento_manual = new Prisma.Decimal(0);
  for (const override of overrides) {
    const group = lines.filter(
      (line) => line.id_propietario_venta === override.id_propietario,
    );
    if (!group.length)
      throw new AppError(
        400,
        "INVALID_OWNER_AMOUNT",
        "El dueño no tiene prendas en esta venta",
      );
    const weights = group.map((line) =>
      BigInt(
        line.precio_unitario_aplicado.mul(line.cantidad).mul(100).toFixed(0),
      ),
    );
    const base = weights.reduce((sum, weight) => sum + weight, 0n);
    const target = BigInt(
      new Prisma.Decimal(override.monto_prendas).mul(100).toFixed(0),
    );
    if (target < 0n || target > base)
      throw new AppError(
        400,
        "INVALID_OWNER_AMOUNT",
        "El importe del dueño debe estar entre cero y el precio de tarifa de sus prendas",
      );
    if (!base) continue;
    const discount = base - target;
    let cumulative = 0n,
      assigned = 0n;
    group.forEach((line, index) => {
      cumulative += weights[index];
      const next = (discount * cumulative) / base;
      line.descuento_manual = new Prisma.Decimal(
        (next - assigned).toString(),
      ).div(100);
      assigned = next;
    });
  }
}
