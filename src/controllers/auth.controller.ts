import type { RequestHandler } from "express";
import { loginSchema } from "../validators/auth.schema.js";
import * as service from "../services/auth.service.js";
import { ok } from "../utils/response.js";

export const login: RequestHandler = async (req, res) => {
  const { email, password, rememberMe } = loginSchema.parse(req.body);
  ok(res, await service.login(email, password, rememberMe));
};
