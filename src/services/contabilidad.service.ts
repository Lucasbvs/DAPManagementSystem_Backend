import { prisma } from "./prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { lineAmount } from "./salePricing.service.js";
import { boliviaDay } from "./ventas.service.js";
import { AppError } from "../utils/AppError.js";
import type { GastoInput } from "../validators/contabilidad.schema.js";

type Movement = {
  id: string;
  fecha: string;
  concepto: string;
  tipo: "Ingreso" | "Costo" | "Gasto";
  importe: string;
  id_propietario: number;
  propietario_nombre: string;
  id_venta: number | null;
};

// Las ventas usan la fecha comercial de Bolivia; los gastos son fechas sin hora.
function monthRange(month: string, offset: string) {
  const start = new Date(`${month}-01T00:00:00${offset}`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { gte: start, lt: end };
}

export async function accountingReport(month: string) {
  // Una sola instantánea evita mezclar una entrega/cancelación concurrente con sus detalles.
  const [owners, sales, manual] = await prisma.$transaction(
    [
      prisma.propietario.findMany({ orderBy: { id_propietario: "asc" } }),
      prisma.venta.findMany({
        where: { estado: "Realizada", fecha: monthRange(month, "-04:00") },
        select: {
          id_venta: true,
          numero_diario: true,
          fecha: true,
          reemplazo_completo: true,
          detalles: {
            include: {
              variante: {
                include: { vestido: { include: { propietario: true } } },
              },
            },
          },
        },
        orderBy: [{ fecha: "desc" }, { id_venta: "desc" }],
      }),
      prisma.movimientoContabilidad.findMany({
        where: {
          fecha: monthRange(month, "Z"),
          // Los ingresos vinculados a ventas ya se calculan desde la venta entregada.
          OR: [{ id_venta: null }, { tipo: { not: "Ingreso" } }],
        },
        include: { propietario: true },
        orderBy: [{ fecha: "desc" }, { id_movimiento: "desc" }],
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  const movements: Movement[] = [];
  for (const sale of sales) {
    const amounts = new Map<number, { name: string; amount: Prisma.Decimal }>();
    for (const line of sale.detalles) {
      if (line.tipo === "Devolucion" && sale.reemplazo_completo) continue;
      const quantity = line.cantidad - line.cantidad_cancelada;
      if (quantity <= 0) continue;
      const ownerId =
        line.id_propietario_venta ?? line.variante.vestido.id_propietario;
      const group = amounts.get(ownerId) ?? {
        name:
          line.propietario_nombre ?? line.variante.vestido.propietario.nombre,
        amount: new Prisma.Decimal(0),
      };
      const amount = lineAmount(line, quantity);
      group.amount = group.amount.plus(
        line.tipo === "Devolucion" ? amount.negated() : amount,
      );
      amounts.set(ownerId, group);
    }
    for (const [ownerId, group] of amounts) {
      movements.push({
        id: `venta-${sale.id_venta}-${ownerId}`,
        fecha: boliviaDay(sale.fecha),
        concepto: `Venta de vestidos · V-${String(sale.numero_diario).padStart(3, "0")}`,
        tipo: "Ingreso",
        importe: group.amount.toFixed(2),
        id_propietario: ownerId,
        propietario_nombre: group.name,
        id_venta: sale.id_venta,
      });
    }
  }
  for (const row of manual)
    movements.push({
      id: `movimiento-${row.id_movimiento}`,
      fecha: row.fecha.toISOString().slice(0, 10),
      concepto: row.concepto,
      tipo: row.tipo,
      importe: row.importe.toFixed(2),
      id_propietario: row.id_propietario,
      propietario_nombre: row.propietario.nombre,
      id_venta: row.id_venta,
    });
  movements.sort((a, b) => b.fecha.localeCompare(a.fecha));

  const summaries = new Map(
    owners.map((owner) => [
      owner.id_propietario,
      {
        id_propietario: owner.id_propietario,
        nombre: owner.nombre,
        ingresos: new Prisma.Decimal(0),
        costos_gastos: new Prisma.Decimal(0),
      },
    ]),
  );
  for (const movement of movements) {
    const summary = summaries.get(movement.id_propietario) ?? {
      id_propietario: movement.id_propietario,
      nombre: movement.propietario_nombre,
      ingresos: new Prisma.Decimal(0),
      costos_gastos: new Prisma.Decimal(0),
    };
    if (movement.tipo === "Ingreso")
      summary.ingresos = summary.ingresos.plus(movement.importe);
    else summary.costos_gastos = summary.costos_gastos.plus(movement.importe);
    summaries.set(summary.id_propietario, summary);
  }
  const totalIncome = [...summaries.values()].reduce(
    (sum, row) => sum.plus(row.ingresos),
    new Prisma.Decimal(0),
  );
  const totalCosts = [...summaries.values()].reduce(
    (sum, row) => sum.plus(row.costos_gastos),
    new Prisma.Decimal(0),
  );
  return {
    mes: month,
    propietarios: [...summaries.values()].map((row) => ({
      id_propietario: row.id_propietario,
      nombre: row.nombre,
      ingresos: row.ingresos.toFixed(2),
      costos_gastos: row.costos_gastos.toFixed(2),
      resultado: row.ingresos.minus(row.costos_gastos).toFixed(2),
    })),
    movimientos: movements,
    totales: {
      ingresos: totalIncome.toFixed(2),
      costos_gastos: totalCosts.toFixed(2),
      resultado: totalIncome.minus(totalCosts).toFixed(2),
    },
  };
}

export async function registerExpense(input: GastoInput) {
  const owner = await prisma.propietario.findUnique({
    where: { id_propietario: input.id_propietario },
  });
  if (!owner)
    throw new AppError(404, "OWNER_NOT_FOUND", "El propietario no existe");
  const row = await prisma.movimientoContabilidad.create({
    data: {
      ...input,
      fecha: new Date(`${input.fecha}T00:00:00Z`),
      importe: new Prisma.Decimal(input.importe),
    },
  });
  return {
    id: `movimiento-${row.id_movimiento}`,
    fecha: input.fecha,
    concepto: row.concepto,
    tipo: row.tipo,
    importe: row.importe.toFixed(2),
    id_propietario: row.id_propietario,
    propietario_nombre: owner.nombre,
    id_venta: null,
  } satisfies Movement;
}
