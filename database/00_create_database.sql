-- Ejecutar UNA VEZ en Query Tool conectado a postgres, con autocommit activado.
-- CREATE DATABASE no se ejecuta dentro de una transacción.
CREATE DATABASE "DAP_db" WITH ENCODING = 'UTF8';
COMMENT ON DATABASE "DAP_db" IS 'DAP Elegancia: inventario, ventas y contabilidad por propietario';
