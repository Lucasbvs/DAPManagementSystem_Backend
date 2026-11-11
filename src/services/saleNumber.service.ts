import type { Prisma } from "../generated/prisma/client.js";
export async function nextSaleNumber(tx: Prisma.TransactionClient, at: Date) {
  const [row] = await tx.$queryRaw<{ next: number }[]>`
  SELECT (COALESCE(MAX(numero_diario),0)+1)::integer AS next
  FROM "Ventas"
  WHERE (fecha AT TIME ZONE 'America/La_Paz')::date =
        (to_timestamp(${at.getTime()}::double precision / 1000.0) AT TIME ZONE 'America/La_Paz')::date
 `;
  return row.next;
}
