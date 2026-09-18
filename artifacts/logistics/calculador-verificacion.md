# Verificación del Calculador de Carga

Fecha: 2026-09-18

## Alcance

Único archivo de producto modificado: `src/pages/carga.tsx`.
No se modificaron backend, contrato, generados, helpers ni otras pantallas.

## Comprobaciones automáticas

- `pnpm run typecheck`: aprobado, código de salida 0.
- `pnpm --filter @workspace/e2e run test:api`: ejecutada completa,
  código de salida 1; 150 pruebas aprobadas y 6 fallidas, en 16 archivos.
- Fallos ajenos al cambio de frontend:
  - Cuatro casos en `rutas-api.test.ts`: respuestas 401 por falta de
    autenticación en las peticiones de pruebas. Problema ya conocido.
  - Un caso en `personnel-almacenes.test.ts`: la prueba intenta convertir la
    clave compuesta de una tabla poblada a una clave por persona; falla por
    duplicados legítimos. Limitación ya documentada en la memoria del proyecto.
  - Un caso en `traslados.test.ts`: esperaba `deleted: 0` y recibió
    `deleted: 1`. Es compatible con la interferencia conocida entre fixtures
    de sincronización sobre la misma base compartida; no se investigó ni
    corrigió fuera del alcance. Esta suite no consume la página modificada.
- Comprobación aislada de las funciones y filtro extraídos de la página:
  `draft`/`sent`, lista blanca `sale`/`done`/null, exclusión de
  `cancel`/desconocidos en Pedidos, búsqueda sin acentos, `#850` con espacios,
  referencia Odoo, combinación de filtros, estados derivados del conjunto
  completo y conjunto vacío: aprobada. Usó datos sintéticos en memoria, no
  sustituyó la evidencia de navegador ni escribió en la base.

## Navegador con datos reales

Sesión Clerk de prueba programática, sin desactivar autenticación, sin mocks
de ventas y sin crear ni modificar registros.

- Cotizaciones y pedidos visibles con badges separados del estado interno.
- `lecheria` encontró registros reales. Búsqueda por orden existente #770.
- Combinación de búsqueda, Tipo y Estado comprobada.
- Búsqueda sin coincidencias mostró el mensaje específico de filtros.
- Cotización #1718 sin medidas: aviso informativo, sin recomendación.
- Pedido #770: precarga de 1 kg y 1 m³, Silverado Chevrolet sugerido.
  Al cambiar localmente el peso a 12000 kg dejó de recomendar vehículo.
  El resumen de Odoo permaneció intacto y no se observaron peticiones
  de escritura. No se hizo una comparación directa de base antes/después.
- Navegación desde el Calculador a Ventas y Pre-Despacho: no aparecieron
  los IDs de cotizaciones comprobados. Despachos conservó su historial.
- El aislamiento también queda respaldado por la clave generada:
  la consulta del Calculador incluye `{ includeQuotations: true }`;
  las consultas de pedidos no incluyen ese parámetro.
- No se comprobó cada variante comercial (`done`, null, etc.) con registros
  reales identificados: esas variantes se comprobaron en la prueba aislada.
  No se vació la base para simular ausencia real de órdenes.

## Evidencia

`carga-mixed-list.png`: captura real 1600×1000 con búsqueda `lecheria`,
Tipo y Estado en Todos. Muestra cotizaciones #1059/#1005 junto al pedido
confirmado #896. No es un mock.