# LogiFleet: evaluación de beta en Replit

## Estado de la evaluación

**Preparación técnica en curso; no autoriza todavía una apertura de beta.**
No se ha publicado esta versión, contratado recursos ni modificado datos de
producción. La publicación consultada usa Autoscale.

## Controles incorporados

- Coordinación de sincronizaciones Odoo con bloqueo PostgreSQL compartido por
  peticiones manuales y procesos periódicos; reintentos limitados a fallos
  transitorios, estado persistente y detección de ejecuciones atascadas.
- Punto de entrada independiente para sincronización. Todavía no se ha activado
  un servicio de pago para ejecutarlo.
- Liveness separada de readiness de base de datos. Odoo no participa en la
  decisión de disponibilidad de la API.
- Autorización explícita por roles existentes y almacenes. No se promueve a un
  administrador basándose en quién inicia sesión primero.
- Intención de auditoría persistida antes de mutaciones, con identificación del
  actor y recurso, sin almacenar cuerpos de peticiones. Un resultado pendiente
  indica incertidumbre y debe investigarse; no demuestra que hubo rollback.
- Verificación de esquema al arrancar; en producción el esquema se aplica mediante
  Publish, no mediante DDL en el proceso de la aplicación.
- Comando de verificación reproducible e integración contra PostgreSQL local
  efímero con datos sintéticos, sin usar la base de desarrollo compartida.

## Condiciones antes de publicar

1. Configurar `ADMIN_EMAILS` con las cuentas responsables reales de inicio de
   sesión. Vincular deliberadamente el personal por correo y revisar sus
   almacenes. Sin este paso la política responde `access_setup_required`.
2. Obtener un resultado satisfactorio de `pnpm run release:check` para el código
   que se publicará y comprobar acceso autorizado en la vista previa.
3. Revisar el diff de esquema de Publish: nuevas columnas de estado de
   sincronización y tabla de auditoría. No elegir sobrescribir datos.
4. Elegir con el propietario el modelo de ejecución: Autoscale no garantiza los
   temporizadores en segundo plano. Reserved VM es una propuesta, no una
   configuración ya aplicada. Si se separa el worker, desactivar el polling
   embebido en la API para no generar ciclos redundantes.
5. Aprobar responsable, retención y objetivos de recuperación. Restaurar un
   respaldo real en un destino aislado autorizado antes de afirmar que la
   recuperación de producción está verificada.
6. Configurar un canal externo de avisos y supervisión independiente si la beta
   necesita notificaciones fuera de la app. Las advertencias dentro de la app y
   los logs no sustituyen un aviso cuando nadie tiene la aplicación abierta.

## Evidencia y límites

El ensayo sintético de dump/restore comprueba herramientas y comparación de
conteos/hash, **no** la recuperabilidad de un respaldo real de producción.
Las pruebas locales tampoco miden disponibilidad ni rendimiento bajo carga.
El 2026-09-21 pasó `pnpm run release:check`: comprobación de tipos del workspace,
builds de API/web, 49 pruebas deterministas y 84 de integración contra PostgreSQL
aislado. Falta comprobar el acceso real en la vista previa una vez configurado el
administrador, antes de activar esta versión del servidor.

Los detalles de comandos y alcance están en los runbooks de publicación y
recuperación; no se declara aprobada toda la suite histórica ni el build móvil.

## Medición de beta: dos semanas

Registrar diariamente: incidentes y duración, errores de API, latencia p95,
tiempo desde la última sincronización exitosa, ejecuciones fallidas/atascadas,
registros de auditoría con resultado pendiente, uso de cómputo y almacenamiento
y costo acumulado. Revisar la estimación mensual usando horas realmente
facturadas, no solo cantidad de usuarios.

La decisión de continuar en Replit debe basarse en estos datos y en la prueba
de recuperación. Los escenarios de costo del runbook no son una factura ni
una garantía de consumo.