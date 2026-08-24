---
name: Medidas por dominio
description: Peso y volumen tienen semántica distinta en ventas y traslados; evita reutilizar el mismo predicado de ausencia
---
Ventas y traslados no comparten la misma interpretación de cero: las ventas consideran los totales no positivos como ausencia por seguridad de capacidad, mientras el contrato de lectura de traslados reserva `null` para ausencia.

La estimación histórica de peso guardada en un traslado solo sirve como fuente de migración para despachos que ya existían y no tenían peso Odoo. Después de copiarla al despacho, no debe usarse como fallback en runtime ni para despachos nuevos.

**Why:** cambiar el helper compartido para satisfacer Traslados altera silenciosamente Ventas, Pre-Despacho y los wizards de vehículo/carga. Reutilizar la estimación del traslado en runtime también rompería la propiedad por despacho y haría que varios despachos compartieran una medida editable.

**How to apply:** conserva la convención global de ventas y usa formateo específico de Traslados para sus medidas nullable. Cualquier transición desde estimaciones antiguas debe ser un backfill idempotente hacia el despacho.