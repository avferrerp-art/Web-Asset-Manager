// Redondea exclusivamente acumulaciones de cuotas parciales; los totales fuente
// de Odoo conservan su precisión y semántica originales.
export function roundPartialQuotaSum(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}