import { z } from "zod";
import { fechaSchema } from "./venta.schema.js";

export const mesContableSchema = z
  .string()
  .regex(
    /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/,
    "Selecciona un mes válido (AAAA-MM)",
  );

export const gastoSchema = z
  .object({
    fecha: fechaSchema,
    concepto: z.string().trim().min(1, "Escribe el concepto").max(150),
    tipo: z.enum(["Costo", "Gasto"]),
    importe: z
      .string()
      .regex(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/, "Importe inválido")
      .refine(
        (value) => Number(value) > 0,
        "El importe debe ser mayor que cero",
      ),
    id_propietario: z.number().int().positive().max(2147483647),
  })
  .strict();

export type GastoInput = z.infer<typeof gastoSchema>;
