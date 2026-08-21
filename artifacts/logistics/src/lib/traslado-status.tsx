import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = {
  por_planificar: "Por planificar",
  planificado: "Planificado",
  en_carga: "En carga",
  en_transito: "En tránsito",
  entregado: "Entregado",
  confirmado_odoo: "Confirmado en Odoo",
  cancelado: "Cancelado",
};

export function TrasladoStatusBadge({
  estadoLogistico,
  estadoOdoo,
}: {
  estadoLogistico: string;
  estadoOdoo: string | null;
}) {
  const state =
    estadoOdoo === "cancel"
      ? "cancelado"
      : estadoOdoo === "done"
        ? "confirmado_odoo"
        : estadoLogistico;

  const className =
    state === "cancelado"
      ? "text-red-500 border-red-500/50"
      : state === "confirmado_odoo" || state === "entregado"
        ? "text-green-500 border-green-500/50 bg-green-500/10"
        : state === "por_planificar"
          ? "text-orange-500 border-orange-500/50"
          : "text-blue-500 border-blue-500/50";

  return (
    <Badge variant="outline" className={className}>
      {LABELS[state] ?? state.replaceAll("_", " ")}
    </Badge>
  );
}