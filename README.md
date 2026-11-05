# DAP Elegancia · Backend

API de DAP Elegancia, un sistema web para administrar el inventario y las ventas de vestidos de una tienda. Centraliza los modelos, sus variantes, existencias, precios y propietarios, y sincroniza los cambios entre dispositivos autorizados.

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

Ventas incluye registro, edición, cambio de prendas, cancelación, filtro por fecha boliviana e impresión de pedidos en PDF. Contabilidad queda pendiente de una siguiente etapa.

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
- Una variante nueva requiere cantidad entera positiva. Una variante existente puede conservar stock cero; nunca se admiten negativos.
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
| GET | `/api/ventas?fecha=AAAA-MM-DD` | Ventas de la fecha, por defecto hoy en Bolivia. |
| POST | `/api/ventas` | Registrar venta y descontar stock. |
| PUT | `/api/ventas/:id` | Editar / cambiar prendas y ajustar existencias. |
| POST | `/api/ventas/:id/cancelar` | Cancelar y devolver stock una sola vez. |
| POST | `/api/ventas/imprimir` | PDF de ventas realizadas de una fecha; cuerpo `{fecha, ids}`. |
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
  "ubicacion_almacen": "A1",
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

No existe registro público. Todas las cuentas activas tienen acceso completo al inventario y ventas. Las cuentas se crean y desactivan mediante los comandos privados del servidor.

La sesión normal dura hasta 8 horas. La opción de mantener sesión iniciada emite un token de 30 días. El cierre de sesión del frontend afecta al navegador actual; desactivar la cuenta impide nuevas peticiones autenticadas.

## Sincronización

Después de una escritura exitosa, el servidor notifica a los clientes SSE conectados. Los eventos contienen el formato JSON estándar dentro de los mensajes `data:`. La conexión se renueva periódicamente para revalidar la sesión.

Los avisos inmediatos se distribuyen dentro de un proceso Node.js. En despliegues con varias instancias, el frontend dispone de una consulta de respaldo cada 15 segundos. La distribución inmediata entre procesos requiere incorporar un canal compartido.

## Despliegue y pruebas

Configurar PostgreSQL, las variables de entorno y el origen definitivo del frontend. Aplicar migraciones, compilar y ejecutar `npm start`. Servir mediante HTTPS y configurar el proxy para permitir SSE sin buffering en `/api/vestidos/events`.

No publicar `.env`, secretos ni credenciales. Los dispositivos deben conectarse a la misma API; `localhost` siempre identifica el equipo desde el cual se abre la aplicación.

Las pruebas de integración utilizan PostgreSQL embebido desechable mediante PGlite en el puerto `55439`, sin utilizar `DAP_db`. Cubren autenticación, validaciones, integridad referencial, migraciones y notificaciones a dos conexiones simultáneas.

## Reglas de ventas

La cantidad total de prendas del pedido determina el tramo para todos sus modelos: 1–2 unitario, 3–5 cuarta, 6 o más media docena. Si el precio del tramo es `NULL`, ese modelo usa su precio unitario; no se hereda otro descuento. El backend calcula todos los importes con Decimal y nunca acepta totales o precios enviados por el cliente.

- `total_cobrado = monto_vestidos + adicional_delivery + costo_envio`.
- `monto_neto = total_cobrado - adicional_delivery - costo_envio - costo_delivery`.
- `costo_delivery` es Bs 10 por pedido, guardado en la venta; puede existir neto negativo.
- El envío departamental lleva departamento, ciudad/provincia y costo, separados del adicional de delivery.
- El número `V-001`, `V-002`, etc. se asigna automáticamente por día de Bolivia; una cancelación no libera ese número.
- Cliente, teléfono, dirección, ubicación, nombre/color/talla y precios se guardan como datos históricos de cada pedido. Al editar sin cambiar el tramo se conserva el precio de las variantes existentes; si cambia el tramo o se agrega una variante, se aplica el catálogo vigente.
- Las operaciones de stock y venta son transaccionales; se validan existencias, edición concurrente mediante `version` y reintentos de registro mediante `clave_registro` (UUID).
- Cancelar conserva la venta y devuelve sus prendas una sola vez. Una venta cancelada no se edita ni se imprime, y queda excluida del resumen.
- El PDF contiene solo las ventas seleccionadas de la fecha solicitada, ordenadas por correlativo, con número de pedido, datos del cliente, prendas/color/talla, cantidades, precios, subtotal, adicional, envío y total. Cada pedido comienza en una página nueva; pedidos extensos continúan en páginas adicionales.
- Registrar, editar o cancelar emite el evento SSE existente, por lo que ventas e inventario se actualizan entre dispositivos.

Ejemplo de registro (`id_variante` debe existir y tener stock):

```json
{
  "clave_registro": "5bbac87c-4ac7-4afd-bac2-2f657f740381",
  "cliente": {"celular":"70000001","nombre":"Cliente","direccion_entrega":"Cochabamba","link_ubicacion":null},
  "detalles": [{"id_variante":1,"cantidad":3}],
  "adicional_delivery":"5.00",
  "departamento_destino":null,
  "ciudad_provincia":null,
  "costo_envio":null
}
```

Editar usa el mismo formato completo y la `version` recibida en la venta. Cancelar recibe `{"version":1}`. Un conflicto responde 409 y requiere recargar antes de reintentar.
