// Baseline migration: full schema as of 2026-07-31, written to be IDEMPOTENT
// so it can run safely against databases previously created with `drizzle-kit push`
// (which leaves no migration history) or partially drifted by task merges.
//
// - Tables: CREATE TABLE IF NOT EXISTS
// - Columns possibly missing from pre-existing tables: ADD COLUMN IF NOT EXISTS
// - UNIQUE constraints: guarded by checking pg_index for an existing unique
//   index on the same column (constraint NAMES may differ between push/migrate)
// - FKs: guarded with exception handlers
export const name = "0000_baseline";

export const sql = `
CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"modelo" text NOT NULL,
	"capacidad_peso" real NOT NULL,
	"capacidad_volumen" real NOT NULL,
	"tipo_combustible" text NOT NULL,
	"rendimiento_km_litro" real NOT NULL,
	"placa" text,
	"tarifa_peaje" real DEFAULT 0,
	"tanque_litros" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "personnel" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"rol" text NOT NULL,
	"tarifa_viaticos" real NOT NULL,
	"telefono" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"cliente" text NOT NULL,
	"vendedor" text,
	"persona_contacto" text,
	"numero_cel" text,
	"tipo_material" text,
	"volumen_total" real NOT NULL,
	"peso_total" real NOT NULL,
	"peso_total_odoo" real,
	"volumen_total_odoo" real,
	"dimensiones_incompletas" boolean DEFAULT false NOT NULL,
	"destino" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"notas" text,
	"odoo_ref" text,
	"odoo_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "sales"
	ADD COLUMN IF NOT EXISTS "peso_total_odoo" real,
	ADD COLUMN IF NOT EXISTS "volumen_total_odoo" real,
	ADD COLUMN IF NOT EXISTS "dimensiones_incompletas" boolean DEFAULT false NOT NULL;
CREATE TABLE IF NOT EXISTS "dispatches" (
	"id" serial PRIMARY KEY NOT NULL,
	"venta_id" integer NOT NULL,
	"vehiculo_id" integer NOT NULL,
	"chofer_id" integer NOT NULL,
	"ayudante_id" integer,
	"fecha_estimada_salida" text NOT NULL,
	"fecha_estimada_llegada" text NOT NULL,
	"ruta" text,
	"estado" text DEFAULT 'pre-despacho' NOT NULL,
	"distancia_km" real,
	"distancia_manual" boolean DEFAULT false NOT NULL,
	"route_id" integer,
	"total_peajes" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "route_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"despacho_id" integer NOT NULL,
	"ubicacion" text NOT NULL,
	"orden" integer NOT NULL,
	"latitud" real,
	"longitud" real,
	"completado" boolean DEFAULT false NOT NULL
);
ALTER TABLE "route_points"
	ADD COLUMN IF NOT EXISTS "completado" boolean DEFAULT false NOT NULL;
CREATE TABLE IF NOT EXISTS "travel_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"despacho_id" integer NOT NULL,
	"costo_peajes" real DEFAULT 0 NOT NULL,
	"costo_combustible" real DEFAULT 0 NOT NULL,
	"costo_viaticos" real DEFAULT 0 NOT NULL,
	"total" real DEFAULT 0 NOT NULL,
	"costo_combustible_por_litro" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "toll_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text DEFAULT 'sencillo' NOT NULL,
	"origen" text NOT NULL,
	"destino" text NOT NULL,
	"distancia_km" real,
	"favorita" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "route_tolls" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 1 NOT NULL,
	"tarifa" real DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS "route_waypoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"ubicacion" text NOT NULL,
	"orden" integer NOT NULL,
	"distancia_km" real DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "sale_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"venta_id" integer NOT NULL,
	"product_id" integer,
	"descripcion" text NOT NULL,
	"cantidad" integer DEFAULT 1 NOT NULL,
	"peso_unitario" real DEFAULT 0 NOT NULL,
	"largo" real DEFAULT 0 NOT NULL,
	"ancho" real DEFAULT 0 NOT NULL,
	"alto" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "sale_items"
	ADD COLUMN IF NOT EXISTS "product_id" integer;
CREATE TABLE IF NOT EXISTS "fuel_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo_combustible" text NOT NULL,
	"precio_por_litro" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "odoo_sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_result" text,
	"last_error" text,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"last_products_sync_at" timestamp with time zone,
	"last_products_result" text,
	"last_products_error" text,
	"products_created_count" integer DEFAULT 0 NOT NULL,
	"products_updated_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "odoo_sync_state"
	ADD COLUMN IF NOT EXISTS "last_products_sync_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "last_products_result" text,
	ADD COLUMN IF NOT EXISTS "last_products_error" text,
	ADD COLUMN IF NOT EXISTS "products_created_count" integer DEFAULT 0 NOT NULL,
	ADD COLUMN IF NOT EXISTS "products_updated_count" integer DEFAULT 0 NOT NULL;
CREATE TABLE IF NOT EXISTS "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"odoo_id" integer NOT NULL,
	"odoo_ref" text,
	"nombre" text,
	"categoria" text,
	"uom" text,
	"peso_odoo" real DEFAULT 0 NOT NULL,
	"volumen_odoo" real DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"peso_kg" real,
	"largo_cm" real,
	"ancho_cm" real,
	"alto_cm" real,
	"apilable" boolean DEFAULT true NOT NULL,
	"fragil" boolean DEFAULT false NOT NULL,
	"notas" text,
	"dimensiones_confirmadas" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "products" ALTER COLUMN "nombre" SET NOT NULL;

-- UNIQUE constraints: add only if no unique index already exists on the column
-- (push-created databases use "<table>_<col>_key" names; migrations use "_unique").
DO $ensure_uniques$
DECLARE
	spec record;
BEGIN
	FOR spec IN
		SELECT * FROM (VALUES
			('personnel',   'email',            'personnel_email_unique'),
			('sales',       'odoo_ref',         'sales_odoo_ref_unique'),
			('sales',       'odoo_id',          'sales_odoo_id_unique'),
			('travel_costs','despacho_id',      'travel_costs_despacho_id_unique'),
			('fuel_prices', 'tipo_combustible', 'fuel_prices_tipo_combustible_unique'),
			('products',    'odoo_id',          'products_odoo_id_unique')
		) AS t(tbl, col, cname)
	LOOP
		IF NOT EXISTS (
			SELECT 1
			FROM pg_index i
			JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
			WHERE i.indrelid = quote_ident(spec.tbl)::regclass
				AND i.indisunique
				AND i.indnkeyatts = 1
				AND a.attname = spec.col
		) THEN
			EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%I)', spec.tbl, spec.cname, spec.col);
		END IF;
	END LOOP;
END
$ensure_uniques$;

-- Foreign keys: guarded against pre-existing constraints with the same name.
DO $fk$ BEGIN
	ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_venta_id_sales_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."sales"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_vehiculo_id_vehicles_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehicles"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_chofer_id_personnel_id_fk" FOREIGN KEY ("chofer_id") REFERENCES "public"."personnel"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_ayudante_id_personnel_id_fk" FOREIGN KEY ("ayudante_id") REFERENCES "public"."personnel"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_route_id_toll_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."toll_routes"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "route_points" ADD CONSTRAINT "route_points_despacho_id_dispatches_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."dispatches"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "travel_costs" ADD CONSTRAINT "travel_costs_despacho_id_dispatches_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."dispatches"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "route_tolls" ADD CONSTRAINT "route_tolls_route_id_toll_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."toll_routes"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "route_waypoints" ADD CONSTRAINT "route_waypoints_route_id_toll_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."toll_routes"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_venta_id_sales_id_fk" FOREIGN KEY ("venta_id") REFERENCES "public"."sales"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
DO $fk$ BEGIN
	ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;
`;
