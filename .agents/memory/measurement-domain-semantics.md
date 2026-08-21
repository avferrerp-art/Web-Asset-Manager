---
name: Medidas por dominio
description: Peso y volumen tienen semántica distinta en ventas y traslados; evita reutilizar el mismo predicado de ausencia
---
Ventas y traslados no comparten la misma interpretación de cero: las ventas consideran los totales no positivos como ausencia por seguridad de capacidad, mientras el contrato de lectura de traslados reserva `null` para ausencia.

**Why:** cambiar el helper compartido para satisfacer Traslados altera silenciosamente Ventas, Pre-Despacho y los wizards de vehículo/carga.

**How to apply:** conserva la convención global de ventas y usa formateo específico de Traslados para sus medidas nullable.