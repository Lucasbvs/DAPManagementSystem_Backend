import { inventoryStream } from "../services/inventoryEvents.service.js";
import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import * as c from "../controllers/inventario.controller.js";

export const inventarioRoutes = Router();
inventarioRoutes.use(authMiddleware);
inventarioRoutes.get("/propietarios", c.owners);
inventarioRoutes.get("/vestidos/events", inventoryStream);
inventarioRoutes.get("/vestidos", c.list);
inventarioRoutes.post("/vestidos", c.create);
inventarioRoutes.put("/vestidos/:id", c.update);
inventarioRoutes.delete("/vestidos/:id", c.remove);
