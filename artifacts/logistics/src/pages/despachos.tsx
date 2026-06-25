import React from "react";
import { 
  useListDispatches, getListDispatchesQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Despachos() {
  const { data: dispatches, isLoading } = useListDispatches({
    query: { queryKey: getListDispatchesQueryKey() }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pre-despacho': return <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">Pre-Despacho</Badge>;
      case 'aprobado': return <Badge variant="outline" className="text-blue-500 border-blue-500/50">Aprobado</Badge>;
      case 'en-ruta': return <Badge variant="outline" className="text-indigo-500 border-indigo-500/50">En Ruta</Badge>;
      case 'entregado': return <Badge variant="outline" className="text-green-500 border-green-500/50">Entregado</Badge>;
      case 'cancelado': return <Badge variant="outline" className="text-red-500 border-red-500/50">Cancelado</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dispatches</h1>
          <p className="text-muted-foreground">All dispatches and current status.</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Driver & Assistant</TableHead>
                <TableHead>Client & Dest</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : dispatches?.map((dispatch) => (
                <TableRow key={dispatch.id}>
                  <TableCell className="font-medium">#{dispatch.id}</TableCell>
                  <TableCell>{dispatch.vehiculoModelo}</TableCell>
                  <TableCell>
                    <div className="text-sm">{dispatch.choferNombre}</div>
                    <div className="text-xs text-muted-foreground">{dispatch.ayudanteNombre || "-"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{dispatch.clienteNombre}</div>
                    <div className="text-xs text-muted-foreground">{dispatch.destino}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">Out: {new Date(dispatch.fechaEstimadaSalida).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">In: {new Date(dispatch.fechaEstimadaLlegada).toLocaleString()}</div>
                  </TableCell>
                  <TableCell>{getStatusBadge(dispatch.estado)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
