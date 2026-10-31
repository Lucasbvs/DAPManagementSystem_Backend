import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./services/prisma.service.js";
await prisma.$connect();
const server = app.listen(env.PORT, () =>
  console.log(`DAP API: http://localhost:${env.PORT}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
  });
