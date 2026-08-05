# Hallazgos: Albaranes (entregas) en Odoo — descubrimiento previo a la integración

Fecha de verificación: 2026-08-05. Todo lo listado fue verificado contra la instancia real de Odoo vía JSON-RPC (`fields_get`, `search_read`, `search_count`) con un script temporal (ya borrado). Nada fue asumido; lo no obtenible figura como **NO VERIFICADO**.

## Versión de Odoo

`common.version` → **Odoo 19.0+e (Enterprise)**, `server_serie: "19.0"`.

Implicación directa: aplican las convenciones de Odoo 17+ (p. ej. `quantity` en vez de `quantity_done`).

## Campos de `stock.picking`

| Campo | ¿Existe? | Tipo | Etiqueta / relación |
|---|---|---|---|
| name | ✅ | char | Reference |
| state | ✅ | selection | Status |
| scheduled_date | ✅ | datetime | Scheduled Date |
| date_done | ✅ | datetime | Date of Transfer |
| origin | ✅ | char | Source Document |
| partner_id | ✅ | many2one | res.partner |
| picking_type_id | ✅ | many2one | stock.picking.type |
| location_id | ✅ | many2one | stock.location |
| location_dest_id | ✅ | many2one | stock.location |
| backorder_id | ✅ | many2one | stock.picking |
| sale_id | ✅ | many2one | sale.order |
| group_id | ❌ NO EXISTE | — | — |
| write_date | ✅ | datetime | Last Updated on |
| company_id | ✅ | many2one | res.company |
| move_ids | ✅ | one2many | stock.move |
| move_ids_without_package | ❌ NO EXISTE | — | — |
| move_lines | ❌ NO EXISTE | — | — |

**Campo de líneas:** el único one2many hacia `stock.move` es **`move_ids`**. No usar `move_ids_without_package` ni `move_lines`.

### Valores de `state` (selection real de la instancia)

| Valor | Etiqueta |
|---|---|
| draft | Draft |
| waiting | Waiting Another Operation |
| confirmed | Waiting |
| assigned | Ready |
| done | Done |
| cancel | Cancelled |

## Campos de `stock.move`

| Campo | ¿Existe? | Tipo | Nota |
|---|---|---|---|
| product_id | ✅ | many2one | product.product |
| product_uom_qty | ✅ | float | "Demand" (cantidad pedida) |
| quantity | ✅ | float | **"Quantity" — ESTE es el campo de cantidad realmente entregada** |
| quantity_done | ❌ NO EXISTE | — | (era Odoo ≤16) |
| product_uom | ✅ | many2one | uom.uom |
| state | ✅ | selection | — |
| picking_id | ✅ | many2one | stock.picking |
| sale_line_id | ✅ | many2one | sale.order.line |

> **PUNTO CRÍTICO confirmado:** en esta instancia (Odoo 19) la cantidad entregada es **`quantity`**. `quantity_done` NO existe y una lectura que lo pida fallará.

## Campos de `stock.warehouse` y `stock.location`

| Modelo | name | code | partner_id | complete_name |
|---|---|---|---|---|
| stock.warehouse | ✅ char "Warehouse" | ✅ char "Short Name" | ✅ many2one "Address" | ❌ NO EXISTE |
| stock.location | ✅ char "Location Name" | ❌ NO EXISTE | ❌ NO EXISTE | ✅ char "Full Location Name" |

## Datos de muestra reales (JSON crudo, sin interpretar)

### Albaranes de S01344 (2, como se esperaba: CCS/OUT/00307 cancelado y LEC/OUT/00611 en Listo/`assigned`)

```json
[
  {
    "id": 1155,
    "name": "CCS/OUT/00307",
    "state": "cancel",
    "scheduled_date": "2026-08-03 13:42:05",
    "date_done": false,
    "origin": "S01344",
    "partner_id": [
      9184,
      "LEITON G.P., C.A."
    ],
    "picking_type_id": [
      18,
      "Caracas: Órdenes de entrega"
    ],
    "location_id": [
      44,
      "CCS/Existencias"
    ],
    "location_dest_id": [
      2,
      "Clientes"
    ],
    "backorder_id": false,
    "sale_id": [
      1344,
      "S01344"
    ],
    "write_date": "2026-08-03 13:42:26",
    "company_id": [
      1,
      "Netso"
    ],
    "move_ids": [
      3441
    ]
  },
  {
    "id": 1156,
    "name": "LEC/OUT/00611",
    "state": "assigned",
    "scheduled_date": "2026-08-03 13:42:32",
    "date_done": false,
    "origin": "S01344",
    "partner_id": [
      9184,
      "LEITON G.P., C.A."
    ],
    "picking_type_id": [
      2,
      "Lecheria: Órdenes de entrega"
    ],
    "location_id": [
      5,
      "LEC/Existencias"
    ],
    "location_dest_id": [
      2,
      "Clientes"
    ],
    "backorder_id": false,
    "sale_id": [
      1344,
      "S01344"
    ],
    "write_date": "2026-08-03 13:42:32",
    "company_id": [
      1,
      "Netso"
    ],
    "move_ids": [
      3442
    ]
  }
]
```

### Albaranes de S01285 (4, como se esperaba: 2 `cancel` y 2 `done`)

```json
[
  {
    "id": 1070,
    "name": "CCS/OUT/00276",
    "state": "cancel",
    "scheduled_date": "2026-07-23 21:59:25",
    "date_done": false,
    "origin": "S01285",
    "partner_id": [
      10157,
      "PRONET COMERCIALIZADORA C.A., GABRIEL VELEZ (DIRECTIVO)"
    ],
    "picking_type_id": [
      18,
      "Caracas: Órdenes de entrega"
    ],
    "location_id": [
      44,
      "CCS/Existencias"
    ],
    "location_dest_id": [
      2,
      "Clientes"
    ],
    "backorder_id": false,
    "sale_id": [
      1285,
      "S01285"
    ],
    "write_date": "2026-07-23 23:38:48",
    "company_id": [
      1,
      "Netso"
    ],
    "move_ids": [
      3249,
      3250,
      3251,
      3252,
      3253,
      3254,
      3255
    ]
  },
  {
    "id": 1072,
    "name": "CCS/OUT/00277",
    "state": "cancel",
    "scheduled_date": "2026-07-23 22:12:18",
    "date_done": false,
    "origin": "S01285",
    "partner_id": [
      10157,
      "PRONET COMERCIALIZADORA C.A., GABRIEL VELEZ (DIRECTIVO)"
    ],
    "picking_type_id": [
      18,
      "Caracas: Órdenes de entrega"
    ],
    "location_id": [
      44,
      "CCS/Existencias"
    ],
    "location_dest_id": [
      2,
      "Clientes"
    ],
    "backorder_id": false,
    "sale_id": [
      1285,
      "S01285"
    ],
    "write_date": "2026-07-23 23:38:48",
    "company_id": [
      1,
      "Netso"
    ],
    "move_ids": [
      3258,
      3259,
      3260,
      3261,
      3262,
      3263,
      3264
    ]
  },
  {
    "id": 1079,
    "name": "LEC/OUT/00575",
    "state": "done",
    "scheduled_date": "2026-07-23 23:39:29",
    "date_done": "2026-07-27 19:21:15",
    "origin": "S01285",
    "partner_id": [
      10493,
      "PRONET COMERCIO Y TELECOMUNICACIONES, C.A"
    ],
    "picking_type_id": [
      2,
      "Lecheria: Órdenes de entrega"
    ],
    "location_id": [
      5,
      "LEC/Existencias"
    ],
    "location_dest_id": [
      2,
      "Clientes"
    ],
    "backorder_id": [
      1073,
      "CCS/OUT/00278"
    ],
    "sale_id": [
      1285,
      "S01285"
    ],
    "write_date": "2026-07-27 19:21:15",
    "company_id": [
      1,
      "Netso"
    ],
    "move_ids": [
      3267,
      3271
    ]
  },
  {
    "id": 1073,
    "name": "CCS/OUT/00278",
    "state": "done",
    "scheduled_date": "2026-07-23 23:39:29",
    "date_done": "2026-07-25 01:46:29",
    "origin": "S01285",
    "partner_id": [
      10493,
      "PRONET COMERCIO Y TELECOMUNICACIONES, C.A"
    ],
    "picking_type_id": [
      18,
      "Caracas: Órdenes de entrega"
    ],
    "location_id": [
      44,
      "CCS/Existencias"
    ],
    "location_dest_id": [
      2,
      "Clientes"
    ],
    "backorder_id": false,
    "sale_id": [
      1285,
      "S01285"
    ],
    "write_date": "2026-07-25 01:46:29",
    "company_id": [
      1,
      "Netso"
    ],
    "move_ids": [
      3265,
      3266,
      3268,
      3269,
      3270
    ]
  }
]
```

Nota observada: LEC/OUT/00575 tiene `backorder_id = [1073, "CCS/OUT/00278"]` — los backorders enlazan al albarán original.

### Detalle de CCS/OUT/00278 (cabecera)

```json
[
  {
    "id": 1073,
    "name": "CCS/OUT/00278",
    "state": "done",
    "scheduled_date": "2026-07-23 23:39:29",
    "date_done": "2026-07-25 01:46:29",
    "origin": "S01285",
    "partner_id": [
      10493,
      "PRONET COMERCIO Y TELECOMUNICACIONES, C.A"
    ],
    "picking_type_id": [
      18,
      "Caracas: Órdenes de entrega"
    ],
    "location_id": [
      44,
      "CCS/Existencias"
    ],
    "location_dest_id": [
      2,
      "Clientes"
    ],
    "backorder_id": false,
    "sale_id": [
      1285,
      "S01285"
    ],
    "write_date": "2026-07-25 01:46:29",
    "company_id": [
      1,
      "Netso"
    ],
    "move_ids": [
      3265,
      3266,
      3268,
      3269,
      3270
    ]
  }
]
```

### Líneas `stock.move` de CCS/OUT/00278 (5 productos, como se esperaba)

```json
[
  {
    "id": 3265,
    "product_id": [
      716,
      "[NTS010029] FIBRA OPTICA ASU 6 HILOS G652.D SUMEC SPAN 100 3KM"
    ],
    "product_uom_qty": 8,
    "quantity": 8,
    "product_uom": [
      1,
      "Units"
    ],
    "state": "done",
    "picking_id": [
      1073,
      "CCS/OUT/00278"
    ],
    "sale_line_id": [
      4569,
      "S01285 - [NTS010029] FIBRA OPTICA ASU 6 HILOS G652.D SUMEC SPAN 100 3KM (PRONET COMERCIO Y TELECOMUNICACIONES, C.A)"
    ]
  },
  {
    "id": 3266,
    "product_id": [
      540,
      "[NTS040035] MANGA DOMO 24C 1 BANDEJA 24 FUSIONES PARA ASU ST-F105H"
    ],
    "product_uom_qty": 20,
    "quantity": 20,
    "product_uom": [
      1,
      "Units"
    ],
    "state": "done",
    "picking_id": [
      1073,
      "CCS/OUT/00278"
    ],
    "sale_line_id": [
      4570,
      "S01285 - [NTS040035] MANGA DOMO 24C 1 BANDEJA 24 FUSIONES PARA ASU ST-F105H (PRONET COMERCIO Y TELECOMUNICACIONES, C.A)"
    ]
  },
  {
    "id": 3268,
    "product_id": [
      475,
      "[NTS040011] CAJA NAP 16 PUERTOS IP65 NETSO CARGADA CON SP 1X16 OTB-P035B"
    ],
    "product_uom_qty": 20,
    "quantity": 20,
    "product_uom": [
      1,
      "Units"
    ],
    "state": "done",
    "picking_id": [
      1073,
      "CCS/OUT/00278"
    ],
    "sale_line_id": [
      4572,
      "S01285 - [NTS040011] CAJA NAP 16 PUERTOS IP65 NETSO CARGADA CON SP 1X16 OTB-P035B (PRONET COMERCIO Y TELECOMUNICACIONES, C.A)"
    ]
  },
  {
    "id": 3269,
    "product_id": [
      573,
      "[NTS060013] PREFORMADO NETSO 7MM"
    ],
    "product_uom_qty": 200,
    "quantity": 200,
    "product_uom": [
      1,
      "Units"
    ],
    "state": "done",
    "picking_id": [
      1073,
      "CCS/OUT/00278"
    ],
    "sale_line_id": [
      4573,
      "S01285 - [NTS060013] PREFORMADO NETSO 7MM (PRONET COMERCIO Y TELECOMUNICACIONES, C.A)"
    ]
  },
  {
    "id": 3270,
    "product_id": [
      533,
      "[NTS060008] HERRAJE DE SUJECION TIPO D YK01"
    ],
    "product_uom_qty": 200,
    "quantity": 200,
    "product_uom": [
      1,
      "Units"
    ],
    "state": "done",
    "picking_id": [
      1073,
      "CCS/OUT/00278"
    ],
    "sale_line_id": [
      4574,
      "S01285 - [NTS060008] HERRAJE DE SUJECION TIPO D YK01 (PRONET COMERCIO Y TELECOMUNICACIONES, C.A)"
    ]
  }
]
```

Productos confirmados: FIBRA OPTICA ASU 6 HILOS, MANGA DOMO 24C, CAJA NAP 16 PUERTOS, PREFORMADO NETSO 7MM, HERRAJE DE SUJECION TIPO D.

## Vínculo albarán → venta

- **`sale_id` existe y viene poblado.** En una muestra de 30 albaranes de salida recientes, `sale_id` estuvo poblado en **30/30**, y en los 30 casos `origin == sale_id[1]` (p. ej. `origin: "S01380"`, `sale_id: [1380, "S01380"]`).
- `origin` trae exactamente la referencia de la orden ("S01285"), sin texto adicional. No se observaron orígenes con varias órdenes separadas por coma entre los 976 albaranes de salida.
- Excepciones encontradas en `origin` (todas sin match posible contra ventas): 26 albaranes con `origin` vacío/false, 5 con "Devolución de CCS/IN/00011" o "Devolución de LEC/IN/00010", 1 con "P00015" (orden de compra), y 1 con el typo "SS1046".
- **Match contra nuestra DB** (todos los 976 albaranes de salida, 765 orígenes únicos): **741 de 765 orígenes únicos matchean exacto contra un `sales.odooRef`** (la DB tiene 746 ventas con `odooRef`). A nivel de albaranes: **912 de 976 pickings** matchean.
- Orígenes únicos sin match (24): 20 son órdenes "S0xxxx" viejas no importadas (S00067, S00101, S00294, S00343, S00362, S00365, S00366, S00436, S00559, S00569, S00635, S00719, S00806, S00832, S00879, S00954, S00967, S01033, S01172, S01196), más las 4 excepciones no-venta listadas arriba (devoluciones, P00015, SS1046).

**Conclusión:** usar **`sale_id`** como vínculo primario (es un many2one directo a `sale.order`, con el id numérico que ya guardamos en `sales.odooId`); `origin` sirve como respaldo/verificación pero puede ser false o texto no-venta.

## Volumen

- `search_count` de `stock.picking` con `picking_type_id.code = 'outgoing'`: **976 albaranes de salida**.
- De esos, **912** corresponden a órdenes ya importadas en nuestra DB.
- Paginación recomendada: el patrón existente de `fetchConfirmedOrders` (batches de 200 por `id asc`) alcanza sin problema (~5 páginas).

## NO VERIFICADO

- Comportamiento de `sale_id` en albaranes muy antiguos o creados manualmente (la muestra de `sale_id` poblado fue de 30 recientes + los 7 de S01344/S01285; no se leyó `sale_id` de los 976).
- Selection de `state` de `stock.move` (no se pidió el atributo selection para ese modelo).
