export function trasladoSinMedida(
  value: number | null | undefined,
): boolean {
  return value == null;
}

export function formatTrasladoMedida(
  value: number | null | undefined,
  unit: "kg" | "m³",
): string {
  return trasladoSinMedida(value) ? "sin dato en Odoo" : `${value} ${unit}`;
}