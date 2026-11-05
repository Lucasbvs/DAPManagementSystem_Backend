import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { ok } from "../utils/response.js";
import { idSchema } from "../validators/vestido.schema.js";
import {
  ventaSchema,
  fechaSchema,
  cancelSchema,
  printSchema,
} from "../validators/venta.schema.js";
import * as sales from "../services/ventas.service.js";
import { notifyInventoryChanged } from "../services/inventoryEvents.service.js";
import { salesPdf } from "../services/salesPdf.service.js";
export const ventasRoutes = Router();
ventasRoutes.use(authMiddleware);
ventasRoutes.get("/ventas", async (req, res) => {
  ok(
    res,
    await sales.listSales(
      fechaSchema.parse(req.query.fecha ?? sales.boliviaDay()),
    ),
  );
});
ventasRoutes.post("/ventas/imprimir", async (req, res) => {
  const { fecha, ids } = printSchema.parse(req.body),
    rows = await sales.printableSales(fecha, ids);
  const bytes = await salesPdf(rows);
  res
    .type("application/pdf")
    .set(
      "Content-Disposition",
      `attachment; filename="DAP-ventas-${fecha}.pdf"`,
    )
    .set("Cache-Control", "no-store")
    .send(bytes);
});
ventasRoutes.post("/ventas", async (req, res) => {
  const row = await sales.saveSale(ventaSchema.parse(req.body));
  notifyInventoryChanged();
  ok(res, row, 201);
});
ventasRoutes.put("/ventas/:id", async (req, res) => {
  const row = await sales.saveSale(
    ventaSchema.parse(req.body),
    idSchema.parse(req.params.id),
  );
  notifyInventoryChanged();
  ok(res, row);
});
ventasRoutes.post("/ventas/:id/cancelar", async (req, res) => {
  const row = await sales.cancelSale(
    idSchema.parse(req.params.id),
    cancelSchema.parse(req.body).version,
  );
  notifyInventoryChanged();
  ok(res, row);
});
