import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../utils/AppError.js";
export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500,
    code = "INTERNAL_ERROR",
    message = "Ocurrió un error interno";
  let details: unknown = null;
  if (err instanceof AppError) ({ status, code, message } = err);
  else if (err instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Revisa los datos enviados";
    details = err.flatten();
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      status = 409;
      code = "DUPLICATE";
      const model =
        typeof err.meta?.modelName === "string" ? err.meta.modelName : null;
      const raw = err.meta?.target;
      const target = Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === "string")
        : typeof raw === "string"
          ? [raw]
          : [];
      details = { model, target };
      const names = target.join(" ");
      message = "Ya existe un registro con esos datos únicos";
      if (model === "Venta" || /Ventas_/.test(names))
        message =
          "No se pudo asignar un identificador único al pedido. Revisa la numeración de ventas";
      if (/numero_diario|fecha_numero/.test(names))
        message =
          "El número de pedido ya está ocupado. Revisa el índice de numeración de ventas";
      if (/id_venta|Ventas_pkey/.test(names))
        message =
          "La secuencia de IDs de ventas está desincronizada con los registros existentes";
      if (
        model === "DetalleVenta" ||
        /Detalle_Venta_pkey|id_detalle/.test(names)
      )
        message =
          "Hay un identificador de detalle duplicado. Revisa la secuencia de Detalle_Venta";
      if (model === "Cliente" && /id_cliente|pkey/.test(names))
        message = "La secuencia de IDs de clientes está desincronizada";
      if (model === "Cliente" && /celular/.test(names))
        message =
          "Existe un conflicto con el celular del cliente. Actualiza e intenta nuevamente";
      if (process.env.NODE_ENV !== "test")
        console.error("Conflicto de clave única", { model, target });
    }
    if (err.code === "P2003") {
      status = 409;
      code = "REFERENCE_CONFLICT";
      message = "Referencia inválida o registro utilizado por una venta";
    }
    if (err.code === "P2025") {
      status = 404;
      code = "NOT_FOUND";
      message = "Registro no encontrado";
    }
    if (err.code === "P2034") {
      status = 409;
      code = "CONCURRENT_CHANGE";
      message = "Los datos cambiaron. Recarga e intenta nuevamente";
    }
  } else if (
    err?.name === "DriverAdapterError" &&
    ["23001", "23503", "23505", "23514"].includes(err.cause?.originalCode)
  ) {
    // PostgreSQL puede devolver RESTRICT directamente desde el adaptador de Prisma 7.
    status = 409;
    code = "DATABASE_CONSTRAINT";
    message =
      "La operación viola una restricción: revisa referencias, duplicados o valores. Los registros con ventas no se pueden eliminar";
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "JSON inválido";
  } else if (err?.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Solicitud demasiado grande";
  }
  if (status === 500) console.error("Error no controlado", err);
  res
    .status(status)
    .json({ success: false, data: null, error: { code, message, details } });
};
