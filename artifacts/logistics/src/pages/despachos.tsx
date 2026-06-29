import React from "react";
import { useListDispatches, getListDispatchesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const ESTADO_BADGE: Record<string, React.ReactElement> = {
  "pre-despacho": <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">Pre-Despacho</Badge>,
  "aprobado":     <Badge variant="outline" className="text-blue-500 border-blue-500/50">Aprobado</Badge>,
  "en-ruta":      <Badge variant="outline" className="text-indigo-500 border-indigo-500/50">En Ruta</Badge>,
  "entregado":    <Badge variant="outline" className="text-green-500 border-green-500/50">Entregado</Badge>,
  "cancelado":    <Badge variant="outline" className="text-red-500 border-red-500/50">Cancelado</Badge>,
};

export default function Despachos() {
  const { data: dispatches, isLoading } = useListDispatches(undefined, {
    query: { queryKey: getListDispatchesQueryKey(), refetchInterval: 30_000 }
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Despachos</h1>
        <p className="text-muted-foreground">Historial y estado actual de todos los despachos.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Vehículo</TableHead>
                <TableHead>Chofer / Ayudante</TableHead>
                <TableHead>Cliente / Destino</TableHead>
                <TableHead>Fechas</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : dispatches?.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Sin despachos registrados.</TableCell></TableRow>
              ) : dispatches?.map((dispatch) => (
                <TableRow key={dispatch.id} data-testid={`row-dispatch-${dispatch.id}`}>
                  <TableCell className="font-medium">#{dispatch.id}</TableCell>
                  <TableCell>{dispatch.vehiculoModelo}</TableCell>
                  <TableCell>
                    <div className="text-sm">{dispatch.choferNombre}</div>
                    <div className="text-xs text-muted-foreground">{dispatch.ayudanteNombre || "—"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{dispatch.clienteNombre}</div>
                    <div className="text-xs text-muted-foreground">{dispatch.destino}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">Salida: {new Date(dispatch.fechaEstimadaSalida).toLocaleDateString("es-MX")}</div>
                    <div className="text-xs text-muted-foreground">Llegada: {new Date(dispatch.fechaEstimadaLlegada).toLocaleDateString("es-MX")}</div>
                  </TableCell>
                  <TableCell>{ESTADO_BADGE[dispatch.estado] ?? <Badge>{dispatch.estado}</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
