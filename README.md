# DAP Elegancia · Backend

API de DAP Elegancia, un sistema web para administrar el inventario de vestidos de una tienda. Centraliza los modelos, sus variantes, existencias, precios y propietarios, y sincroniza los cambios entre dispositivos autorizados.

El backend y el frontend se mantienen en repositorios independientes y se comunican mediante HTTP. La base de datos PostgreSQL se denomina `DAP_db`.

## Alcance

- Autenticación privada con correo y contraseña, JWT y verificación de cuentas activas.
- Registro, consulta, edición y eliminación de vestidos y variantes.
- Numeración automática de vestidos mediante una secuencia PostgreSQL.
- Variantes por color y talla opcional, con existencias independientes.
- Cálculo del stock total de cada modelo.
- Precio unitario obligatorio; precios de cuarta y media docena opcionales.
- Asociación de cada modelo con su propietario.
- Notificaciones de cambios mediante Server-Sent Events (SSE).
- Administración de cuentas desde la consola del servidor.

Ventas y contabilidad cuentan con un modelo de datos preparado, pero sus operaciones de negocio aún no están implementadas.

## Tecnologías

Node.js, TypeScript, Express 5, Prisma ORM 7, PostgreSQL, Zod, JSON Web Tokens y bcrypt. pgAdmin 4 puede utilizarse para administrar PostgreSQL.

## Requisitos

- Node.js 22.12 o superior compatible con las dependencias.
- npm.
- PostgreSQL 15 o superior.
- Una base de datos vacía llamada `DAP_db` para la instalación inicial.

## Instalación

Ejecutar dentro de este repositorio:

```bash
npm ci
```

Copiar `.env.example` a `.env`. En PowerShell:

```powershell
Copy-Item .env.example .env
```

Configurar las variables:

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Conexión PostgreSQL a `DAP_db`. |
| `PORT` | Puerto de la API; por defecto, `3000`. |
| `CORS_ORIGIN` | Origen permitido del frontend, por ejemplo `http://localhost:5173`. |
| `JWT_SECRET` | Secreto aleatorio de al menos 32 caracteres. |
| `ADMIN_EMAIL` | Correo de la cuenta inicial creada por el seed. |
| `ADMIN_PASSWORD` | Contraseña inicial segura para el seed. |
| `NODE_ENV` | Entorno de ejecución. |

Generar un secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Crear la base de datos desde pgAdmin, conectado a `postgres`, ejecutando `database/00_create_database.sql`. Después aplicar las migraciones y los datos iniciales:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

API local: `http://localhost:3000/api`. El seed registra la cuenta inicial y los propietarios Ana y Dylan; no crea vestidos de demostración ni reemplaza contraseñas existentes.

Para bases existentes, aplicar únicamente las migraciones pendientes. `database/01_schema_pgadmin.sql` es una alternativa de instalación manual; no debe ejecutarse sobre una base ya migrada.

## Comandos

| Comando | Función |
| --- | --- |
| `npm run dev` | Ejecutar el servidor de desarrollo. |
| `npm run build` | Generar Prisma Client y compilar TypeScript. |
| `npm start` | Ejecutar el servidor compilado. |
| `npm run db:generate` | Generar Prisma Client. |
| `npm run db:migrate` | Aplicar migraciones existentes. |
| `npm run db:dev` | Crear y aplicar migraciones durante el desarrollo. |
| `npm run db:seed` | Registrar los datos iniciales. |
| `npm run user:create` | Crear una cuenta mediante preguntas en consola. |
| `npm run user:deactivate` | Desactivar una cuenta con confirmación. |
| `npm test` | Ejecutar las pruebas automatizadas. |

## Estructura

| Directorio o archivo | Responsabilidad |
| --- | --- |
| `src/routes/` | Rutas y protección de endpoints. |
| `src/controllers/` | Entrada HTTP y respuestas. |
| `src/services/` | Reglas de negocio, acceso a datos y eventos. |
| `src/validators/` | Validación de datos de entrada. |
| `src/middlewares/` | Autenticación y errores globales. |
| `src/config/` | Configuración de entorno. |
| `src/scripts/` | Administración privada de cuentas. |
| `src/types/`, `src/utils/` | Tipos y utilidades comunes. |
| `src/app.ts`, `src/server.ts` | Aplicación Express y arranque del servidor. |
| `prisma/` | Esquema, migraciones y seed. |
| `database/` | Scripts SQL de instalación. |
| `tests/` | Pruebas de API, migraciones y consola. |

## Modelo de datos

El dominio incluye `Propietarios`, `Vestidos`, `Variantes_Vestido`, `Clientes`, `Ventas`, `Detalle_Venta` y `Movimientos_Contabilidad`. Las cuentas de acceso se almacenan en `Users`.

- El precio unitario debe ser mayor que cero. Los precios opcionales se guardan como `NULL` cuando no existen; si se informan, también deben ser positivos.
- Los importes se almacenan como `DECIMAL(10,2)` y se intercambian como cadenas decimales en JSON.
- El registro y la edición de inventario requieren cantidades enteras positivas por variante.
- El número de vestido lo genera el servidor; no se recibe en el formulario y puede tener saltos.
- No se permiten variantes repetidas de color y talla dentro de un modelo.
- Eliminar un vestido elimina sus variantes, salvo que existan detalles de venta que impidan el borrado por integridad referencial.

## API

Las rutas protegidas requieren `Authorization: Bearer <token>`.

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/health` | Estado de la API; público. |
| POST | `/api/auth/login` | Inicio de sesión; público con limitación de intentos. |
| GET | `/api/propietarios` | Listar propietarios. |
| GET | `/api/vestidos` | Listar vestidos y existencias. |
| POST | `/api/vestidos` | Registrar un vestido. |
| PUT | `/api/vestidos/:id` | Actualizar un vestido y sus variantes. |
| DELETE | `/api/vestidos/:id` | Eliminar un vestido. |
| GET | `/api/vestidos/events` | Flujo SSE autenticado de cambios de inventario. |

Formato de respuesta:

```json
{ "success": true, "data": {}, "error": null }
```

```json
{
  "success": false,
  "data": null,
  "error": { "code": "UNAUTHORIZED", "message": "Inicia sesión para continuar", "details": null }
}
```

Ejemplo de registro:

```json
{
  "nombre": "Aurora",
  "descripcion": "Vestido de satén",
  "precio_unitario": "95.00",
  "precio_cuarta": null,
  "precio_media_docena": "80.00",
  "id_propietario": 1,
  "variantes": [
    { "color": "Verde", "talla": "M", "cantidad_stock": 5 }
  ]
}
```

Utilizar un propietario existente. En una edición, conservar el `id_variante` de las variantes existentes; las nuevas no llevan ID. `PUT` representa el formulario completo: las variantes omitidas se eliminan si las relaciones lo permiten.

## Acceso y sesiones

No existe registro público. Todas las cuentas activas tienen acceso completo al inventario. Las cuentas se crean y desactivan mediante los comandos privados del servidor.

La sesión normal dura hasta 8 horas. La opción de mantener sesión iniciada emite un token de 30 días. El cierre de sesión del frontend afecta al navegador actual; desactivar la cuenta impide nuevas peticiones autenticadas.

## Sincronización

Después de una escritura exitosa, el servidor notifica a los clientes SSE conectados. Los eventos contienen el formato JSON estándar dentro de los mensajes `data:`. La conexión se renueva periódicamente para revalidar la sesión.

Los avisos inmediatos se distribuyen dentro de un proceso Node.js. En despliegues con varias instancias, el frontend dispone de una consulta de respaldo cada 15 segundos. La distribución inmediata entre procesos requiere incorporar un canal compartido.

## Despliegue y pruebas

Configurar PostgreSQL, las variables de entorno y el origen definitivo del frontend. Aplicar migraciones, compilar y ejecutar `npm start`. Servir mediante HTTPS y configurar el proxy para permitir SSE sin buffering en `/api/vestidos/events`.

No publicar `.env`, secretos ni credenciales. Los dispositivos deben conectarse a la misma API; `localhost` siempre identifica el equipo desde el cual se abre la aplicación.

Las pruebas de integración utilizan PostgreSQL embebido desechable mediante PGlite en el puerto `55439`, sin utilizar `DAP_db`. Cubren autenticación, validaciones, integridad referencial, migraciones y notificaciones a dos conexiones simultáneas.
