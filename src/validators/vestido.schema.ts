import { z } from "zod";
const integer = z.number().int().min(0).max(2147483647);
const money = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/,
    "Importe inválido (máximo 2 decimales)",
  )
  .refine((v) => Number(v) > 0, "El precio debe ser mayor que cero");
export const idSchema = z.coerce.number().int().positive().max(2147483647);
export const vestidoSchema = z
  .object({
    ubicacion_almacen: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-M][1-9][0-9]{0,17}$/,
        "Usa una ubicación entre A1 y M seguida de un número positivo, por ejemplo M12",
      ),
    nombre: z.string().trim().min(1).max(50),
    descripcion: z.string().trim().min(1).max(150),
    precio_unitario: money,
    precio_cuarta: money.nullish().transform((v) => v ?? null),
    precio_media_docena: money.nullish().transform((v) => v ?? null),
    id_propietario: integer.refine((v) => v > 0),
    variantes: z
      .array(
        z
          .object({
            id_variante: integer.refine((v) => v > 0).optional(),
            color: z.string().trim().min(1).max(30),
            talla: z
              .string()
              .trim()
              .max(10)
              .nullable()
              .transform((v) => v || null),
            cantidad_stock: integer,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const [i, item] of v.variantes.entries())
      if (item.cantidad_stock === 0 && !item.id_variante)
        ctx.addIssue({
          code: "custom",
          path: ["variantes", i, "cantidad_stock"],
          message: "Una variante nueva debe tener una cantidad mayor que cero",
        });
    if (
      v.precio_cuarta !== null &&
      Number(v.precio_cuarta) >= Number(v.precio_unitario)
    )
      ctx.addIssue({
        code: "custom",
        path: ["precio_cuarta"],
        message: "El precio de cuarta debe ser menor que el precio unitario",
      });
    if (
      v.precio_media_docena !== null &&
      Number(v.precio_media_docena) >= Number(v.precio_unitario)
    )
      ctx.addIssue({
        code: "custom",
        path: ["precio_media_docena"],
        message:
          "El precio de media docena debe ser menor que el precio unitario",
      });
    if (
      v.precio_cuarta !== null &&
      v.precio_media_docena !== null &&
      Number(v.precio_media_docena) >= Number(v.precio_cuarta)
    )
      ctx.addIssue({
        code: "custom",
        path: ["precio_media_docena"],
        message:
          "El precio de media docena debe ser menor que el precio de cuarta",
      });
    const keys = v.variantes.map(
      (x) => `${x.color.toLowerCase()}|${(x.talla ?? "").toLowerCase()}`,
    );
    const ids = v.variantes.flatMap((x) =>
      x.id_variante ? [x.id_variante] : [],
    );
    if (new Set(keys).size !== keys.length || new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["variantes"],
        message: "No repitas variantes ni identificadores",
      });
  });
export type VestidoInput = z.infer<typeof vestidoSchema>;
