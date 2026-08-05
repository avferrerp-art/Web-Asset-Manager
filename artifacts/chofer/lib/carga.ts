/**
 * Helper compartido (app chofer) para mostrar peso/volumen de carga.
 * Convención: 0, null o undefined = "sin dato en Odoo" — nunca "0 kg".
 */

export function sinDatoCarga(value: number | null | undefined): boolean {
  return value == null || value <= 0;
}

/** "33.46 kg" | "sin dato en Odoo" */
export function formatCarga(value: number | null | undefined, unit: "kg" | "m³"): string {
  return sinDatoCarga(value)
    ? "sin dato en Odoo"
    : `${value!.toLocaleString("es-DO")} ${unit}`;
}
