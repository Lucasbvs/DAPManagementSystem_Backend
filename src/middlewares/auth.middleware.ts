import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../services/prisma.service.js";
import { AppError } from "../utils/AppError.js";
export const authMiddleware: RequestHandler = async (req, _res, next) => {
  const match = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match)
    throw new AppError(401, "UNAUTHORIZED", "Inicia sesión para continuar");
  let userId: number;
  try {
    const payload = jwt.verify(match[1], env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "dap-api",
      audience: "dap-web",
    });
    if (
      typeof payload === "string" ||
      !payload.sub ||
      !/^\d+$/.test(payload.sub)
    )
      throw new Error();
    userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error();
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "Sesión inválida o vencida");
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, active: true },
  });
  if (!user?.active)
    throw new AppError(401, "UNAUTHORIZED", "Usuario no disponible");
  req.user = { id: user.id };
  next();
};
