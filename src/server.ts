import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./services/prisma.service.js";
import { startDailySalesClose } from "./services/dailySalesClose.service.js";
await prisma.$connect();
const stopDailySalesClose = startDailySalesClose();
const server = app.listen(env.PORT, () =>
  console.log(`DAP API: http://localhost:${env.PORT}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    const stopped = stopDailySalesClose();
    server.close(() => {
      void stopped.then(() => prisma.$disconnect()).then(() => process.exit(0));
    });
  });
