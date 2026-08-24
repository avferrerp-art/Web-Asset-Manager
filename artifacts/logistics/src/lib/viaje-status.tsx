import { Badge } from "@/components/ui/badge";
import type { ViajeEstado } from "@workspace/api-client-react";

const labels: Record<ViajeEstado, string> = {
  planificado: "Planificado",
  en_curso: "En curso",
  completado: "Completado",
  cancelado: "Cancelado",
};

const classes: Record<ViajeEstado, string> = {
  planificado: "text-blue-500 border-blue-500/50",
  en_curso: "text-indigo-500 border-indigo-500/50 bg-indigo-500/10",
  completado: "text-green-500 border-green-500/50 bg-green-500/10",
  cancelado: "text-red-500 border-red-500/50",
};

export function ViajeStatusBadge({ estado }: { estado: ViajeEstado }) {
  return (
    <Badge variant="outline" className={classes[estado]}>
      {labels[estado]}
    </Badge>
  );
}
