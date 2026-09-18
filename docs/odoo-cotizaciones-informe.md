# Informe de importación de cotizaciones de Odoo

Mediciones realizadas el 18 de septiembre de 2026 sobre el commit base
`bbdf9a1` (`Permitir fechas editables en planes de reparto`). Ese commit es el
ancestro mínimo solicitado y era también el `HEAD` al tomar la línea base.

## Condiciones

- Odoo conectado: 19.0+e.
- La base y las cuatro variables de conexión de Odoo estaban disponibles. No
  se copiaron valores ni secretos al informe.
- Las corridas se ejecutaron directamente contra `syncOdooOrders`, sin
  arrancar ni reiniciar workflows.
- Odoo no expuso `res.partner.mobile`; el lector lo omitió mediante su
  degradación esperada y conservó los campos de dirección.
- El sync detectó diferencias de partidas en `S01375` tanto antes como
  después y no creó una alerta. Sin un historial remoto de auditoría no
  puede atribuirse esa diferencia a ediciones concurrentes en Odoo ni
  distinguirlas de una diferencia de reconciliación local.
- No se ejecutaron suites de tests antes de terminar estas mediciones.

## Línea base, antes del cambio

Antes de la corrida había 987 ventas:

- 979 importadas de Odoo.
- 8 manuales.
- 1 `sync_alert` histórica.

La corrida original, cuyo dominio era solamente `sale` y `done`, comenzó a
las `2026-09-18T18:48:24.809Z`, terminó a las
`2026-09-18T18:48:26.008Z` y duró **1.199 s**.

Resultado:

- 977 órdenes leídas en el dominio.
- 0 importadas.
- 976 omitidas por no tener cambios.
- 1 con cambio detectado: `S01375` (`partidas`).
- 0 alertas creadas.

Después de estabilizar esa corrida siguieron existiendo exactamente 987
ventas (979 Odoo y 8 manuales).

## Migración

La primera invocación de `runMigrations()` aplicó
`0019_sales_odoo_estado`; las migraciones 0000–0018 ya estaban aplicadas. La
segunda invocación no aplicó nada y omitió 0000–0019, confirmando la
repetibilidad por el mecanismo real de migraciones.

Inmediatamente antes del primer sync ampliado, a las
`2026-09-18T18:49:41.287295Z`, había:

- 987 ventas totales.
- 979 ventas Odoo y 8 manuales.
- 987 filas con `odoo_estado = 'sale'`, resultado del backfill.
- 0 filas con `odoo_estado IS NULL`.
- 1 alerta histórica; la más reciente era del
  `2026-08-04T19:43:01.337656Z`.

## Primera corrida ampliada

La primera corrida con `draft`, `sent`, `sale` y `done` comenzó a las
`2026-09-18T18:49:50.256Z`, terminó a las
`2026-09-18T18:49:57.856Z` y duró **7.599 s**.

Resultado:

- 791 cotizaciones importadas.
- 976 órdenes omitidas por no tener cambios.
- La misma orden `S01375` presentó el cambio de partidas indicado arriba.
- 0 alertas creadas.

La corrida ampliada fue **6,34 veces** más lenta que la línea base
(+6.400 s). Esta primera corrida hizo trabajo adicional real: leyó líneas,
productos y contactos y persistió 791 órdenes nuevas, mientras que la corrida
base no tuvo altas.

Después de la corrida había 1.778 ventas:

| `odooEstado` | Filas |
| --- | ---: |
| `draft` | 790 |
| `sent` | 1 |
| `sale` | 987 |
| `done` | 0 |
| `NULL` | 0 |

El aumento fue exactamente de **791 filas**, igual al número de cotizaciones
informado por el sync. Permaneció una sola alerta histórica y no apareció
ninguna alerta con fecha posterior al comienzo de la corrida ampliada.

## Verificación del listado

El servidor que estaba activo exigía autenticación y `GET /api/sales` sin
credenciales respondió 401. No se alteró ni se evitó la autenticación para
obtener una medición del servidor activo.

Para comprobar el router real se montó `salesRouter` temporalmente en una
instancia aislada de Express, sin middleware de autenticación. El harness se
eliminó al terminar. Por tanto, estos son resultados HTTP reales del router,
pero **no son una prueba autenticada del servidor activo**:

| Consulta | HTTP | Filas | Estados comerciales |
| --- | ---: | ---: | --- |
| `GET /sales` | 200 | 987 | `sale`: 987 |
| `GET /sales?includeQuotations=false` | 200 | 987 | `sale`: 987 |
| `GET /sales?includeQuotations=true` | 200 | 1.778 | `sale`: 987, `draft`: 790, `sent`: 1 |
| `GET /sales?status=pendiente` | 200 | 979 | `sale`: 979 |
| `GET /sales?includeQuotations=true&status=pendiente` | 200 | 1.770 | `sale`: 979, `draft`: 790, `sent`: 1 |

La consulta sin parámetros devolvió exactamente las 987 filas de la línea
base. El parámetro textual `false` produjo el mismo resultado. El modo
ampliado agregó exactamente las 791 cotizaciones, y el filtro `status`
continuó combinándose con la selección comercial.

## Cotización de ejemplo

Fila completa de `S01811`, junto con sus partidas:

```json
{
  "id": 1786,
  "cliente": "CORPORACION WAVERED DE VENEZUELA C.A",
  "vendedor": "Jose Angel Marcano",
  "persona_contacto": "CORPORACION WAVERED DE VENEZUELA C.A",
  "numero_cel": null,
  "tipo_material": "[NTS010038] FIBRA OPTICA ASU 24 HILOS G652.D SUMEC SPAN 100 4KM, [NTS060001] ESCALERA EXTENSIBLE 24' PIES CON APOYA POSTE Y GUINDA CABLE NETSO",
  "volumen_total": null,
  "peso_total": null,
  "peso_total_odoo": 0,
  "volumen_total_odoo": 0,
  "dimensiones_incompletas": false,
  "destino": "AV SANTIAGO MARIÑO EDIF BLUE SKY PISO PB LOCAL 8, PLANTA BAJA SECTOR TACHIRA, Porlamar, Nueva Esparta (VE), Venezuela",
  "estado": "pendiente",
  "odoo_estado": "draft",
  "estado_entrega": "sin_albaran",
  "almacen_origen": null,
  "almacenes_multiples": false,
  "notas": "Terms &amp; Conditions: https://www.netso.io/terms",
  "odoo_ref": "S01811",
  "odoo_id": 1811,
  "odoo_write_date": "2026-09-18 18:37:14",
  "created_at": "2026-09-18T18:49:57.841611+00:00",
  "items": [
    {
      "id": 4834,
      "venta_id": 1786,
      "product_id": 236,
      "descripcion": "FIBRA OPTICA ASU 24 HILOS G652.D SUMEC SPAN 100 4KM",
      "cantidad": 2,
      "peso_unitario": 0,
      "largo": 0,
      "ancho": 0,
      "alto": 0,
      "created_at": "2026-09-18T18:49:57.844662+00:00"
    },
    {
      "id": 4835,
      "venta_id": 1786,
      "product_id": 33,
      "descripcion": "ESCALERA EXTENSIBLE 24' PIES CON APOYA POSTE Y GUINDA CABLE NETSO",
      "cantidad": 3,
      "peso_unitario": 0,
      "largo": 0,
      "ancho": 0,
      "alto": 0,
      "created_at": "2026-09-18T18:49:57.844662+00:00"
    }
  ]
}
```

`peso_total` y `volumen_total` respetan la regla local de representar
“sin dato en Odoo” con `null`; los campos originales recibidos de Odoo
permanecen separados.

## Verificación técnica final

- `pnpm run typecheck`: **correcto** en todos los paquetes.
- Regresiones nuevas: **14/14 correctas**, en tres archivos. Cubren listas
  blancas, NULL, `false` textual, combinaciones con `status`, migración SQL
  ejecutada dos veces en un schema aislado, inserción/actualización,
  paginación, transición a venta con identidad de partidas intacta (también
  sin vínculo al catálogo), guard operativo, fechas idénticas y dry-run.
- `pnpm --filter @workspace/e2e run test:api`: **151 correctos y 5 fallidos**
  (156 tests; 14 archivos correctos y 2 fallidos; 12,44 s). No se presenta la
  suite completa como aprobada:
  - Cuatro fallos en `rutas-api.test.ts`: solicitudes sin autenticación,
    respuesta 401 del servidor protegido.
  - Un fallo en `personnel-almacenes.test.ts`: intenta crear una PK de solo
    `personnel_id` sobre datos reales que ya tienen múltiples almacenes;
    PostgreSQL rechaza la clave duplicada. Son problemas previamente
    documentados del proyecto, fuera de este cambio. No se modificaron sus
    tests, la política de autenticación ni los datos reales para ocultarlos.
- Reinicio del API correcto: el log confirmó `Schema verification passed:
  all expected tables, columns and unique constraints present`, sin
  `SCHEMA MISMATCH`.
- Comprobación visual básica: la web carga su pantalla de acceso sin errores
  de ejecución. No se modificaron pantallas web ni móviles; no se afirma
  haber verificado visualmente las pantallas protegidas.
- La comprobación HTTP autenticada contra el servidor activo queda
  **bloqueada** por falta de una sesión utilizable. Las regresiones HTTP
  automatizadas usan autenticación simulada, no una sesión real.

Para preservar partidas intactas al confirmar cotizaciones sin producto en
el catálogo local, el reconciliador utiliza la misma clave por descripción
en ambos lados cuando falta ese vínculo. No cambia el mapeo de cantidades,
destinos ni totales.

## Limitación conocida

El sync de órdenes no reconcilia borrados remotos. Si una cotización en
borrador se borra en Odoo, su fila local permanecerá en LogiFleet. Esta tarea
documenta el problema y deliberadamente no implementa detección de borrados.