# Verificación del Calculador de Carga — artículos

Fecha: 2026-09-18

## Entorno y alcance

- Ruta real: `/carga`, Logistics Manager (`/`) con API real activa.
- Autenticación: sesión Clerk programática de prueba (`Test User`), sin
  desactivar autenticación y sin interactuar con la UI de Clerk.
- No se crearon, modificaron ni eliminaron registros. La única eliminación
  observada fue local en la lista temporal del calculador.
- Se observó la red durante las acciones: cero solicitudes `POST`, `PUT`,
  `PATCH` o `DELETE`.
- El navegador no ejecutó la suite API ni typecheck; el agente principal sí
  ejecutó ambos, con los resultados siguientes.

## Validación automática

- `pnpm run typecheck`: aprobado (salida 0).
- `pnpm --filter @workspace/e2e run test:api`: ejecutada completa,
  150 aprobadas y 6 fallidas en 16 archivos (salida 1).
- Son los mismos fallos documentados en `calculador-verificacion.md`:
  cuatro respuestas 401 en Rutas, conflicto de clave primaria en
  `personnel-almacenes.test.ts` y `deleted: 1` frente a `0` en
  `traslados.test.ts`. No se modificaron estas áreas.
- La suite existente crea y limpia fixtures de base de datos. La afirmación
  de cero escrituras de este informe se refiere al nuevo Calculador y a las
  comprobaciones de navegador, no a la ejecución de esa suite.
- Comprobación adicional en memoria de los planificadores existentes:
  carga de 150 kg y volumen null con dos vehículos de 100 kg. Flota
  simultánea produce dos camiones distintos; sucesivos, dos viajes del mismo
  camión; todas las cuotas de volumen conservan null. Aprobada, sin base.

## Comprobaciones reales de navegador

- La carga inicial en `Armar de cero` no hizo ninguna petición
  `/api/products`.
- Búsqueda vacía/no coincidente: `lecheria` produjo exactamente
  `GET /api/products?search=lecheria` y el estado específico
  `No hay artículos que coincidan con la búsqueda.`.
- Búsqueda real `a` produjo exactamente
  `GET /api/products?search=a` y resultados reales con nombre y referencia,
  incluyendo `ABRAZADERA PARA CAJA NAP` / `NTS040047` (peso `0.04 kg`,
  volumen sin dato). Se verificó el estado de resultados cargados; no se
  observaron estados stale/error durante estas respuestas.
- Se agregaron cuatro copias independientes del mismo artículo. Las filas
  conservaron cantidades `1`, `2`, `3`, `4`, con subtotales `0.04`, `0.08`,
  `0.12`, `0.16 kg`.
- Al borrar la primera fila, las filas posteriores quedaron independientes y
  conservaron `2`, `3`, `4` (`article-row-2` a `article-row-4`).
- Cantidad `0`, negativa `-1`, decimal `1.5`, texto `abc` y entero inseguro
  `9007199254740992` mostraron `La cantidad debe ser un entero positivo
  seguro.` y ocultaron recomendaciones/repartos. Al recuperar `2`, desapareció
  el warning y volvió un vehículo `SUGERIDO`.
- Para artículos sin volumen se verificó `Volumen total: sin dato` y el aviso:
  `Ningún artículo tiene volumen en Odoo. La estimación considera solo el peso;
  verifica que la carga quepa físicamente.`. Con peso disponible, Silverado
  Chevrolet apareció como `SUGERIDO`.
- `Vaciar lista` dejó cero filas y cero solicitudes de escritura. Tras recargar
  `/carga`, el modo artículos siguió disponible y la lista permaneció vacía.

## Casos restantes completados en la misma pasada

- Búsqueda real `#10` (con espacios) mostró la orden #10. `Rodríguez`
  devolvió destinos reales con `Rodríguez` y `RODRIGUEZ`, verificando
  coincidencia sin acentos.
- Filtros reales: `Cotizaciones` dejó solo badges Cotización en las filas
  muestreadas; `pendiente` dejó solo filas pendientes. Al cambiar a
  `Armar de cero` y regresar se conservaron `Rodríguez`, `Cotizaciones` y
  `pendiente`.
- Orden real #1758 precargó 0.01 kg y 0.01 m³ con recomendación. Al vaciar
  peso apareció `warning-sin-peso` y desapareció la recomendación; al restaurar
  manualmente 12 kg y 3 m³ volvió `SUGERIDO`, sin solicitudes de escritura.
- Datos ausentes se cubrieron explícitamente con fixture **solo de navegador**
  interceptando `/api/products?search=fixture`: `Fixture Conocido` (100 kg/1
  m³), `Fixture Sin Peso` (null/1 m³) y `Fixture Denso` (1000 kg/0.001 m³).
  La mezcla mostró total parcial, `Peso incompleto` y recomendación basada en
  el peso conocido; esto no representa datos persistidos de Odoo.
- Con el fixture denso en cantidad 100 (100100 kg, 2.1 m³) se verificó warning
  de densidad, `Ningún vehículo soporta esta carga`, `Flota simultánea` no
  viable (`La flota completa no alcanza para esta carga`) y `Viajes sucesivos`
  con 10 viajes del Mitsubishi FM 657 2, incluidos los límites visibles de
  11000 kg/0.231 m³ y el último tramo de 1100 kg/0.021 m³.
- La búsqueda fixture `slow` mostró `Buscando artículos...`; cambiar antes
  de resolver a `fixture` dejó los tres resultados nuevos y no el resultado
  stale. La respuesta fixture HTTP 500 `error` terminó mostrando
  `No se pudieron buscar los artículos: ApiError: HTTP 500 Internal Server
  Error: fixture failure` (captura `cd0z32`).

## Evidencia visual actualizada

Se guardó el screenshot full-page solicitado en:
`artifacts/logistics/screenshots/carga-articulos-recomendacion.png`.
Capturas de observación relacionadas: `3cv9ge`, `w7lea2`, `9l9f66`,
`fy9xyf` y `cd0z32`.

## Limitaciones

- Productos sin peso/volumen y densidad usaron fixture de navegador por ausencia
  de datos reales adecuados; quedó identificado y no se escribió en la base.
- Los 500, la respuesta lenta y sus productos también fueron fixtures de
  navegador; la respuesta vacía `lecheria` sí fue del servidor real.

## Corrección y casos finales completados

- Se usó la búsqueda real estrecha `NTS040047` (no se repitió la búsqueda
  amplia `a`). El resultado real fue `ABRAZADERA PARA CAJA NAP` / `NTS040047`,
  0.04 kg y volumen sin dato. Se agregó una fila y se verificó
  `badge-sugerido` para Silverado Chevrolet junto al warning de volumen.
  La captura correcta está ahora en
  `artifacts/logistics/screenshots/carga-articulos-recomendacion.png`.
  La captura de reparto grande permanece separada en
  `artifacts/logistics/screenshots/carga-articulos-reparto.png`.
- Con un fixture pequeño de navegador se verificó el caso de **todas** las
  filas sin peso: 2/2 filas sin peso, warning `Ningún artículo tiene peso en
  Odoo` y cero `SUGERIDO`. Al agregar una fila con peso y volumen faltante se
  verificaron simultáneamente `Peso incompleto` y `Volumen incompleto` (2 de 3
  filas sin peso y 2 de 3 sin volumen).
- La cantidad cruda vacía (`input-quantity-4` = `""`) mostró
  `warning-invalid-quantity` y suprimió recomendaciones; al restaurar `1`,
  el warning desapareció.
- La carga pequeña viable mostró `badge-sugerido` y no mostró
  `informational-split-plans`, cubriendo compatibilidad individual, no reparto
  simultáneo. El reparto simultáneo viable se comprobó en memoria. Con el
  mismo fixture y cantidad `200000` (2,000,000 kg), el estado no mostró una
  lista de viajes: informó explícitamente que el plan sucesivo requiere más
  de 10 tramos, además de no-fit y warning de densidad.
- Preservación bidireccional completada: con la lista/búsqueda de artículos
  `mini` poblada (3 filas, cantidades 1/1/200000), se volvió a Orden, se
  seleccionó la orden real #1758, se cambiaron valores manuales a 12 kg/3 m³,
  se regresó a Artículos (lista y búsqueda seguían presentes) y luego a Orden.
  La orden #1758 y los valores manuales 12/3 siguieron presentes; la captura
  final de orden `k1hmbk` muestra esa conservación y Silverado/Panel L300
  sugerido.

## Incidencia del entorno de pruebas

La búsqueda amplia `a` agotó el tiempo del worker en dos intentos posteriores.
La referencia exacta permitió continuar y obtener la captura real. No se
determinó si el origen era el worker, el volumen de resultados o el servidor.