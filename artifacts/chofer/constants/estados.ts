export const ESTADO_LABELS: Record<string, string> = {
  "pre-despacho": "Pre-despacho",
  aprobado: "Aprobado",
  "en-ruta": "En ruta",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const ESTADO_COLORS: Record<string, { bg: string; fg: string }> = {
  "pre-despacho": { bg: "#334155", fg: "#cbd5e1" },
  aprobado: { bg: "#1e3a8a", fg: "#93c5fd" },
  "en-ruta": { bg: "#78350f", fg: "#fcd34d" },
  entregado: { bg: "#14532d", fg: "#86efac" },
  cancelado: { bg: "#7f1d1d", fg: "#fca5a5" },
};

export function estadoLabel(estado: string): string {
  return ESTADO_LABELS[estado] ?? estado;
}

export function estadoColor(estado: string): { bg: string; fg: string } {
  return ESTADO_COLORS[estado] ?? { bg: "#334155", fg: "#cbd5e1" };
}
