import { z } from "zod";
const money = z
  .string()
  .regex(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/, "Importe inválido");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
export const departamentos = [
  "La_Paz",
  "Cochabamba",
  "Santa_Cruz",
  "Oruro",
  "Potosi",
  "Tarija",
  "Chuquisaca",
  "Beni",
  "Pando",
] as const;
export const ventaSchema = z
  .object({
    clave_registro: z.uuid(),
    version: z.number().int().positive().optional(),
    cliente: z
      .object({
        celular: z
          .string()
          .trim()
          .regex(/^\+?[0-9]{7,14}$/, "Celular inválido"),
        nombre: optionalText(100),
        direccion_entrega: optionalText(255),
        link_ubicacion: z
          .union([
            z.url().refine((v) => /^https?:\/\//i.test(v), "Usa http o https"),
            z.literal(""),
            z.null(),
          ])
          .optional()
          .transform((v) => v || null),
      })
      .strict(),
    detalles: z
      .array(
        z
          .object({
            id_variante: z.number().int().positive().max(2147483647),
            cantidad: z.number().int().min(1).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    adicional_delivery: money,
    departamento_destino: z.enum(departamentos).nullable(),
    ciudad_provincia: optionalText(100),
    costo_envio: money.nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.detalles.map((x) => x.id_variante)).size !== v.detalles.length
    )
      c.addIssue({
        code: "custom",
        path: ["detalles"],
        message: "No repitas variantes",
      });
    if (
      v.departamento_destino &&
      (!v.ciudad_provincia || v.costo_envio === null)
    )
      c.addIssue({
        code: "custom",
        path: ["ciudad_provincia"],
        message: "Completa ciudad y costo de envío",
      });
    if (
      !v.departamento_destino &&
      (v.ciudad_provincia || v.costo_envio !== null)
    )
      c.addIssue({
        code: "custom",
        path: ["departamento_destino"],
        message: "Selecciona el departamento de envío",
      });
  });
export const fechaSchema = z.iso.date();
export const cancelSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const printSchema = z
  .object({
    fecha: fechaSchema,
    ids: z.array(z.number().int().positive().max(2147483647)).min(1).max(100),
  })
  .strict();
export type VentaInput = z.infer<typeof ventaSchema>;
