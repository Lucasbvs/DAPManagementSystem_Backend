import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { login } from "../controllers/auth.controller.js";

export const authRoutes = Router();
authRoutes.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    message: {
      success: false,
      data: null,
      error: {
        code: "TOO_MANY_ATTEMPTS",
        message: "Demasiados intentos. Intenta más tarde",
        details: null,
      },
    },
  }),
  login,
);
