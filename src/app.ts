import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { authRoutes } from "./routes/auth.routes.js";
import { ventasRoutes } from "./routes/ventas.routes.js";
import { inventarioRoutes } from "./routes/inventario.routes.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { AppError } from "./utils/AppError.js";
import { ok } from "./utils/response.js";

export const app = express();
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "100kb" }));
app.get("/api/health", (_req, res) => {
  ok(res, { status: "ok" });
});
app.use("/api/auth", authRoutes);
app.use("/api", inventarioRoutes);
app.use("/api", ventasRoutes);
app.use((_req, _res, next) =>
  next(new AppError(404, "NOT_FOUND", "Ruta no encontrada")),
);
app.use(errorMiddleware);
