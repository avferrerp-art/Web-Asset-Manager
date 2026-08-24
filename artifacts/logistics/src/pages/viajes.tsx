import React, { useEffect, useState } from "react";
import {
  getListViajesQueryKey,
  useListViajes,
  type ListViajesParams,
  type Viaje,
} from "@workspace/api-client-react";
import { CalendarDays, Route, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ViajeDetailSheet } from "@/components/viaje-detail-sheet";
import { ViajeStatusBadge } from "@/lib/viaje-status";
import { matchesSearch } from "@/lib/search";
import { useLocation, useRoute } from "wouter";

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-VE", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function Viajes() {
  const [search, setSearch] = useState("");
  const [estado, setEstado] = useState("todos");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [matchesDetailRoute, routeParams] = useRoute("/viajes/:id");
  const [, navigate] = useLocation();
  useEffect(() => {
    const id = matchesDetailRoute ? Number(routeParams?.id) : null;
    setSelectedId(Number.isInteger(id) && (id as number) > 0 ? id : null);
  }, [matchesDetailRoute, routeParams?.id]);
  const params: ListViajesParams = estado === "todos" ? {} : { estado: estado as ListViajesParams["estado"] };
  const { data: viajes, isLoading, error } = useListViajes(params, {
    query: { queryKey: getListViajesQueryKey(params), refetchInterval: 30_000 },
  });
  const filtered = search.trim()
    ? (viajes ?? []).filter((viaje) => matchesSearch(search, [
        viaje.id, `#${viaje.id}`, viaje.vehiculoModelo, viaje.choferNombre, viaje.ayudanteNombre, viaje.fecha,
      ]))
    : viajes ?? [];

  return (
    <div className="space-y-6">
      <ViajeDetailSheet viajeId={selectedId} open={selectedId !== null} onOpenChange={(open) => { if (!open) { setSelectedId(null); navigate("/viajes"); } }} />
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-foreground">
          <Route className="h-8 w-8 text-primary" /> Viajes
        </h1>
        <p className="mt-1 text-muted-foreground">Viajes compartidos y sus paradas operativas.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[240px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-8" placeholder="Buscar por recurso, fecha o #viaje..." data-testid="input-search-viajes" />
        </div>
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="w-[180px]" data-testid="select-estado-viajes"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="planificado">Planificado</SelectItem>
            <SelectItem value="en_curso">En curso</SelectItem>
            <SelectItem value="completado">Completado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Viaje</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Vehículo</TableHead>
                  <TableHead>Chofer / Ayudante</TableHead>
                  <TableHead>Paradas</TableHead>
                  <TableHead>Costos</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center">Cargando viajes...</TableCell></TableRow>
                ) : error ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center text-destructive">{error instanceof Error ? error.message : "No se pudieron cargar los viajes."}</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">{search.trim() || estado !== "todos" ? "Sin viajes para los filtros actuales." : "Aún no hay viajes compartidos."}</TableCell></TableRow>
                ) : filtered.map((viaje: Viaje) => (
                  <TableRow key={viaje.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/viajes/${viaje.id}`)} data-testid={`row-viaje-${viaje.id}`}>
                    <TableCell className="font-medium">#{viaje.id}</TableCell>
                    <TableCell><span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{formatDate(viaje.fecha)}</span></TableCell>
                    <TableCell>{viaje.vehiculoModelo ?? "—"}</TableCell>
                    <TableCell><div>{viaje.choferNombre ?? "—"}</div><div className="text-xs text-muted-foreground">{viaje.ayudanteNombre ?? "Sin ayudante"}</div></TableCell>
                    <TableCell>{viaje.cantidadDespachos}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{viaje.totalPeajesEstimado != null ? `$${Number(viaje.totalPeajesEstimado).toFixed(2)}` : viaje.distanciaTotalKm != null ? `${viaje.distanciaTotalKm} km` : "—"}</TableCell>
                    <TableCell><ViajeStatusBadge estado={viaje.estado} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}