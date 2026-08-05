/**
 * Helper compartido para mostrar peso/volumen de carga.
 *
 * Convención del dominio: un total de Odoo igual a 0, null o undefined
 * significa "sin dato en Odoo" — nunca "pesa cero". Nadie despacha 0 kg.
 */

export function sinDatoCarga(value: number | null | undefined): boolean {
  return value == null || value <= 0;
}

/** "33.46 kg" | "sin dato en Odoo" */
export function formatCarga(value: number | null | undefined, unit: "kg" | "m³"): string {
  return sinDatoCarga(value) ? "sin dato en Odoo" : `${value} ${unit}`;
}
