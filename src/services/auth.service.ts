import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.service.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const dummyHash = bcrypt.hashSync("dummy-password-never-used", 12);
export async function login(
  email: string,
  password: string,
  rememberMe = false,
) {
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
  if (!user?.active || !valid)
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Correo o contraseña incorrectos",
    );
  const token = jwt.sign({}, env.JWT_SECRET, {
    algorithm: "HS256",
    subject: String(user.id),
    expiresIn: rememberMe ? "30d" : "8h",
    issuer: "dap-api",
    audience: "dap-web",
  });
  return { token, user: { id: user.id, name: user.name, email: user.email } };
}
