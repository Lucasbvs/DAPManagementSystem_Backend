import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { ok } from "../utils/response.js";
import {
  gastoSchema,
  mesContableSchema,
} from "../validators/contabilidad.schema.js";
import {
  accountingReport,
  registerExpense,
} from "../services/contabilidad.service.js";
import { boliviaDay } from "../services/ventas.service.js";
import { notifyInventoryChanged } from "../services/inventoryEvents.service.js";

export const contabilidadRoutes = Router();
contabilidadRoutes.use(authMiddleware);
contabilidadRoutes.get("/contabilidad", async (req, res) => {
  const month = mesContableSchema.parse(
    req.query.mes ?? boliviaDay().slice(0, 7),
  );
  res.set("Cache-Control", "no-store");
  ok(res, await accountingReport(month));
});
contabilidadRoutes.post("/contabilidad/gastos", async (req, res) => {
  const row = await registerExpense(gastoSchema.parse(req.body));
  notifyInventoryChanged();
  ok(res, row, 201);
});
