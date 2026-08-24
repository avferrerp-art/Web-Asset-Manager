# LogiFleet

Sistema de gestión logística de flota: planifica despachos de ventas (propias o importadas de Odoo), calcula rutas con peajes y combustible, administra vehículos y personal, e incluye una app móvil para choferes y una calculadora de carga volumétrica.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/e2e run test:api` — Vitest suite: API/service tests (rutas HTTP flows + piezas críticas: sync de productos Odoo con cliente mockeado, backfill/vinculación y calculadora de carga). Requiere `DATABASE_URL`; no requiere Odoo real. Los tests de rutas requieren además el api-server corriendo en `localhost:80/api`.
- `pnpm --filter @workspace/e2e run test` — Playwright browser suite (rutas UI); requiere la web corriendo en `localhost:80`
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env (Odoo sync): `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` — if missing, sync stays silently disabled
- Optional env (warehouse authorization): `ADMIN_EMAILS` — comma-separated administrative email bypass list, with no default. If omitted, incomplete or unlinked personnel records still retain their normal full-access fallback.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Auth: Clerk (web + API; mobile uses Bearer tokens)

## Where things live

- `lib/db/src/schema/` — source of truth del schema de DB (Drizzle): `vehicles`, `personnel`, `sales`, `sale_items`, `dispatches`, `toll_routes`, `route_tolls`, `route_waypoints`, `route_points`, `travel_costs`, `fuel_prices`, `odoo_sync`, `conversations`, `messages`
- `lib/api-spec/openapi.yaml` — contrato OpenAPI (fuente de verdad de la API); `lib/api-spec/orval.config.ts` configura el codegen
- `lib/api-zod` — schemas Zod + tipos TS generados desde el spec (no editar `src/generated/`)
- `lib/api-client-react` — hooks React Query generados desde el spec (no editar `src/generated/`)
- `artifacts/api-server` — API Express; routers en `src/routes/` (registrados en `src/routes/index.ts`), servicios en `src/services/` (incl. sync de Odoo), cliente Odoo en `src/lib/odooClient.ts`
- Movimientos Odoo: `src/services/deliverySync.ts` sincroniza pickings `outgoing` e `internal` y sus líneas hacia `deliveries` / `delivery_items`; cada picking interno sin `sale_id` también mantiene su `traslados` de planificación. `deliveryEstado.ts` deriva `sales.estadoEntrega` solo de movimientos tipo venta.
- `artifacts/logistics` — web de gestión (React + Vite): dashboard, ventas, pre-despacho, despachos, rutas, vehículos, personal, calculadora de carga (`src/pages/carga.tsx`), configuración
- `artifacts/chofer` — app móvil Expo para choferes (LogiFleet Chofer): auth + tabs + detalle de despacho
- `artifacts/mockup-sandbox` — canvas de mockups/preview de componentes (solo diseño, no producción)

## Architecture decisions

- **Contrato API primero (Orval)**: la API se define en `lib/api-spec/openapi.yaml`; `pnpm --filter @workspace/api-spec run codegen` regenera dos paquetes: `lib/api-client-react` (hooks React Query, mode split, mutator `custom-fetch.ts`) y `lib/api-zod` (schemas Zod usados por el servidor para validar). El título del spec debe seguir siendo "Api" (los import paths dependen de eso).
- **Modelo ventas → despachos**: `sales` es la orden (cliente, destino, peso/volumen totales, estado); `sale_items` son las partidas (FK `venta_id`, cascade delete; solo productId, descripción y cantidad); `dispatches` referencia `venta_id`, `vehiculo_id`, `chofer_id` (y ayudante/route opcionales) con estado que arranca en `pre-despacho`.
- **Peso y volumen vienen SIEMPRE de Odoo** (`pesoTotalOdoo`/`volumenTotalOdoo`, espejados en `pesoTotal`/`volumenTotal`). Sin dato en Odoo = `null`, nunca 0 (un 0 se leería como dato real y arruinaría la recomendación de vehículo); la UI muestra "sin dato en Odoo". El módulo de medición manual fue eliminado (ago 2026): las columnas de dimensiones (`products.peso_kg/largo_cm/ancho_cm/alto_cm/apilable/fragil/dimensiones_confirmadas`, `sale_items.peso_unitario/largo/ancho/alto`, `sales.dimensiones_incompletas`) quedan dormidas en la DB con sus datos, sin uso en el código. Cobertura real a nivel venta: 63% con peso (473/755) y 31% con volumen (237/755). El catálogo de artículos es solo lectura desde Odoo salvo `notas`; si falta volumen, la calculadora recomienda solo por peso y avisa que la recomendación está incompleta.
- **Sync de Odoo**: `src/lib/odooClient.ts` habla JSON-RPC con Odoo (config vía secretos `ODOO_*`; si faltan, retorna null y el sync se salta en silencio). `src/services/odooSync.ts` importa órdenes confirmadas (`state in [sale, done]`) como filas de `sales`, calculando peso/volumen desde líneas y productos; idempotente por `odoo_id` unique + `onConflictDoNothing`. Corre por polling cada 5 min (primer run ~10s tras boot) y registra el resultado en la tabla `odoo_sync_state` (una sola fila).
- **Auth por orden de routers**: en `src/routes/index.ts`, `healthRouter` va antes de `requireAuth`; todo router montado después queda protegido automáticamente por Clerk.

## Product

- Gestión de flota (vehículos con capacidades) y personal (choferes/ayudantes)
- Ventas manuales o importadas automáticamente desde Odoo
- Pre-despacho y despachos: asignación de vehículo, chofer y ruta con estimación de costos (distancia, peajes, combustible con precios configurables)
- Rutas con estaciones de peaje y waypoints
- Calculadora de carga volumétrica que recomienda vehículos según bultos
- App móvil Expo para que el chofer vea y gestione sus despachos

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Tras tocar `lib/api-spec/openapi.yaml`: correr `pnpm --filter @workspace/api-spec run codegen` para regenerar hooks y Zod; nunca editar los directorios `generated/` a mano.
- **Migraciones de DB (mecanismo persistente)**: el api-server aplica migraciones automáticamente al arrancar (`runMigrations()` en `lib/db/src/migrate.ts`, SQL embebido en `lib/db/src/migrations/`, tracking en la tabla `_migrations`). Tras tocar `lib/db/src/schema/`, NO basta con `drizzle-kit push` (ese cambio manual no sobrevive merges a main): hay que agregar una migración numerada en `lib/db/src/migrations/` (SQL idempotente: `IF NOT EXISTS` / constraints con guardas), registrarla en su `index.ts`, y reiniciar el api-server. Al arrancar, el server también verifica el schema (`verifySchema()`) y loguea `SCHEMA MISMATCH` por cada tabla/columna/UNIQUE faltante.
- Tras cambiar cualquier lib (`api-zod`, `db`, etc.): reiniciar el workflow del api-server — el servidor bundlea con esbuild al arrancar, no hace hot-reload de las libs.
- Routers nuevos en `src/routes/index.ts` deben montarse después de `requireAuth` (salvo endpoints públicos como health).
- **`sales.estado` vs `sales.estadoEntrega` — NO mezclar**: `estado` (pendiente | despachado | entregado | cancelado) es el estado INTERNO de LogiFleet y lo deriva exclusivamente `saleEstadoSync.ts` desde los despachos. `estadoEntrega` (sin_albaran | pendiente | parcial | entregado | cancelado) es el estado REAL de entrega en Odoo, derivado de los albaranes por `deliveryEstado.ts`. Una venta puede estar "despachada" internamente con su albarán aún sin validar en Odoo — es información útil, no un conflicto. Nunca escribir `estado` desde la lógica de albaranes ni viceversa.
- **Rutina post-apply de sync Odoo (orden de endpoints)**: `POST /api/odoo/sync-products` → `POST /api/odoo/sync` → `POST /api/odoo/backfill-products` → `POST /api/odoo/backfill-destinos` → `POST /api/odoo/sync-deliveries` → `POST /api/odoo/backfill-deliveries` → `POST /api/odoo/backfill-traslados` (solo histórico inicial; no avanza el watermark).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
