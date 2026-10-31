import {
  createAccount,
  deactivateAccount,
} from "../services/accounts.service.js";
import { prisma } from "../services/prisma.service.js";
import { createPrompter } from "../utils/consolePrompt.js";
const prompts = createPrompter();
const ask = prompts.ask;
try {
  if (!process.stdin.isTTY)
    throw new Error("Ejecuta este comando en una terminal interactiva");
  const action = process.argv[2];
  if (action === "create") {
    console.log(
      "\nCREAR CUENTA\nCompleta los datos. La contraseña se escribe de forma oculta.\n",
    );
    const name = await ask("Nombre: "),
      email = await ask("Correo: ");
    const password = await ask(
      "Contraseña (12 caracteres mínimo, entrada oculta): ",
      true,
    );
    if (password !== (await ask("Repite la contraseña: ", true)))
      throw new Error("Las contraseñas no coinciden");
    const user = await createAccount({ name, email, password });
    console.log(`Cuenta creada: ${user.email}. Acceso total al inventario.`);
  } else if (action === "deactivate") {
    console.log(
      "\nDESACTIVAR CUENTA\nEsta acción bloquea el acceso; no elimina el usuario.\n",
    );
    const email = await ask("Correo de la cuenta a desactivar: ");
    if (
      (await ask(`Desactivar ${email}: escribe SI para confirmar: `)) !== "SI"
    )
      throw new Error("Operación cancelada");
    const user = await deactivateAccount(email);
    console.log(`Cuenta desactivada: ${user.email}`);
  } else throw new Error("Usa create o deactivate");
} catch (error) {
  const e = error as { code?: string; message?: string };
  console.error(
    e.code === "P2002"
      ? "Ya existe una cuenta con ese correo. No se modificó."
      : (e.message ?? "No se pudo completar la operación"),
  );
  process.exitCode = 1;
} finally {
  prompts.close();
  await prisma.$disconnect();
}
