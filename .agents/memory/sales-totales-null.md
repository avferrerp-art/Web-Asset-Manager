---
name: Totales de venta null = sin dato
description: pesoTotal/volumenTotal de sales son espejo de los totales de Odoo; null significa "sin dato", nunca 0
---
Regla: `sales.pesoTotal/volumenTotal` se espejan SIEMPRE desde `pesoTotalOdoo/volumenTotalOdoo` (via `recalcSales` en productBackfill); Odoo null o 0 → local null.
**Why:** un 0 se lee como dato real y hace que la calculadora recomiende un camión demasiado chico; el módulo de medición manual fue eliminado (ago 2026) y sus columnas quedan dormidas en la DB (reversible, no borrarlas ni reusarlas).
**How to apply:** cualquier código nuevo que muestre o compare peso/volumen de una venta debe tratar null como "sin dato en Odoo" (UI) y no bloquear/asumir 0 en comparaciones de capacidad; nada debe escribir pesoTotalOdoo/volumenTotalOdoo salvo el sync de Odoo.
