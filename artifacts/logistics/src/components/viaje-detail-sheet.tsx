import React, { useEffect, useState } from "react";
import {
  getGetViajeQueryKey,
  getListPersonnelQueryKey,
  getListVehiclesQueryKey,
  getGetDispatchQueryKey,
  useGetViaje,
  useGetDispatch,
  useListPersonnel,
  useListVehicles,
  useUpdateDispatch,
  useUpdateViaje,
  type ViajeDetail,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Edit2, Loader2, Save, Unlink, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { refreshViajeOperationalData } from "@/lib/viaje-cache";
import { ViajeStatusBadge } from "@/lib/viaje-status";
import type { Dispatch } from "@workspace/api-client-react";
import { sinDatoCarga } from "@/lib/carga";
import { trasladoSinMedida } from "@/lib/traslado-medidas";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 border-b border-border/40 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium min-w-0">{children ?? "—"}</span>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-VE", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function ViajeStop({
  dispatch,
  index,
  isDetaching,
  onDetach,
}: {
  dispatch: Dispatch;
  index: number;
  isDetaching: boolean;
  onDetach: () => void;
}) {
  const { data: detail, isLoading } = useGetDispatch(dispatch.id, {
    query: { queryKey: getGetDispatchQueryKey(dispatch.id) },
  });
  const weightMissing = dispatch.tipo === "venta"
    ? sinDatoCarga(detail?.pesoTotal)
    : trasladoSinMedida(detail?.pesoTotal);
  const volumeMissing = dispatch.tipo === "venta"
    ? sinDatoCarga(detail?.volumenTotal)
    : trasladoSinMedida(detail?.volumenTotal);

  return (
    <div className="flex gap-3 p-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {dispatch.tipo === "venta" ? dispatch.clienteNombre || `Venta #${dispatch.ventaId}` : dispatch.referencia || `Traslado #${dispatch.trasladoId}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {dispatch.tipo === "traslado" && dispatch.origen ? `${dispatch.origen} → ` : ""}
          {dispatch.destino || dispatch.ruta || "Sin destino"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {isLoading ? "Cargando carga…" : (
            <>
              Peso: {weightMissing ? "sin dato" : `${detail?.pesoTotal} kg`}
              {" · "}
              Volumen: {volumeMissing ? "sin dato" : `${detail?.volumenTotal} m³`}
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Despacho #{dispatch.id} · {dispatch.estado}</p>
      </div>
      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDetach} disabled={isDetaching} data-testid={`button-retirar-parada-${dispatch.id}`}>
        <Unlink className="mr-1 h-3.5 w-3.5" /> Retirar
      </Button>
    </div>
  );
}

interface ViajeDetailSheetProps {
  viajeId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ViajeDetailSheet({ viajeId, open, onOpenChange }: ViajeDetailSheetProps) {
  if (viajeId === null) return null;
  return <ViajeDetailSheetInner viajeId={viajeId} open={open} onOpenChange={onOpenChange} />;
}

function ViajeDetailSheetInner({
  viajeId,
  open,
  onOpenChange,
}: {
  viajeId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: viaje, isLoading, error } = useGetViaje(viajeId, {
    query: { queryKey: getGetViajeQueryKey(viajeId) },
  });
  const { data: vehicles } = useListVehicles({ query: { queryKey: getListVehiclesQueryKey() } });
  const { data: personnel } = useListPersonnel({ query: { queryKey: getListPersonnelQueryKey() } });
  const updateViaje = useUpdateViaje();
  const updateDispatch = useUpdateDispatch();
  const [editing, setEditing] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [assistantId, setAssistantId] = useState("0");
  const [fecha, setFecha] = useState("");
  const [distancia, setDistancia] = useState("");
  const [peajes, setPeajes] = useState("");
  const [notas, setNotas] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setMutationError(null);
  }, [viajeId, open]);

  function populateForm(record: ViajeDetail) {
    setVehicleId(String(record.vehiculoId));
    setDriverId(String(record.choferId));
    setAssistantId(record.ayudanteId ? String(record.ayudanteId) : "0");
    setFecha(record.fecha);
    setDistancia(record.distanciaTotalKm?.toString() ?? "");
    setPeajes(record.totalPeajesEstimado?.toString() ?? "");
    setNotas(record.notas ?? "");
    setMutationError(null);
    setEditing(true);
  }

  function refresh(dispatchIds: number[] = []) {
    refreshViajeOperationalData(queryClient, { viajeId, dispatchIds });
  }

  function save() {
    if (!vehicleId || !driverId || !fecha) {
      setMutationError("Indica vehículo, chofer y fecha.");
      return;
    }
    updateViaje.mutate(
      {
        id: viajeId,
        data: {
          vehiculoId: Number(vehicleId),
          choferId: Number(driverId),
          ayudanteId: assistantId === "0" ? null : Number(assistantId),
          fecha,
          notas: notas.trim() || null,
          distanciaTotalKm: distancia.trim() ? Number(distancia) : null,
          totalPeajesEstimado: peajes.trim() ? Number(peajes) : null,
        },
      },
      {
        onSuccess: (updated) => {
          refresh(updated.despachos.map((dispatch) => dispatch.id));
          setEditing(false);
          toast({ title: "Datos compartidos del viaje actualizados" });
        },
        onError: (mutation) => {
          setMutationError(mutation instanceof Error ? mutation.message : "No se pudo actualizar el viaje.");
        },
      },
    );
  }

  function detach(dispatchId: number) {
    setMutationError(null);
    updateDispatch.mutate(
      { id: dispatchId, data: { viajeId: null } },
      {
        onSuccess: () => {
          refresh([dispatchId]);
          toast({ title: `Despacho #${dispatchId} retirado del viaje` });
        },
        onError: (mutation) => {
          setMutationError(mutation instanceof Error ? mutation.message : "No se pudo retirar la parada.");
        },
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[700px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div>
              <SheetTitle>Viaje #{viajeId}</SheetTitle>
              {viaje && <div className="mt-2"><ViajeStatusBadge estado={viaje.estado} /></div>}
            </div>
            {viaje && !editing && (
              <Button size="sm" variant="outline" onClick={() => populateForm(viaje)} data-testid="button-editar-viaje">
                <Edit2 className="mr-1 h-3.5 w-3.5" /> Editar
              </Button>
            )}
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error || !viaje ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No se pudo cargar el viaje</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : "El viaje no está disponible."}</AlertDescription>
          </Alert>
        ) : editing ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Los recursos se aplican a todas las paradas del viaje.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Vehículo</Label>
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{vehicles?.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.modelo}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Chofer</Label>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{personnel?.filter((item) => item.rol === "chofer").map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ayudante</Label>
                <Select value={assistantId} onValueChange={setAssistantId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Ninguno</SelectItem>
                    {personnel?.filter((item) => item.rol === "ayudante").map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Distancia total (km)</Label>
                <Input type="number" min="0" step="any" value={distancia} onChange={(event) => setDistancia(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Peajes estimados</Label>
                <Input type="number" min="0" step="any" value={peajes} onChange={(event) => setPeajes(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea value={notas} onChange={(event) => setNotas(event.target.value)} />
            </div>
            {mutationError && (
              <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{mutationError}</AlertDescription></Alert>
            )}
            <div className="flex gap-2">
              <Button onClick={save} disabled={updateViaje.isPending} data-testid="button-guardar-viaje">
                {updateViaje.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                Guardar
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={updateViaje.isPending}><X className="mr-1 h-4 w-4" /> Cancelar</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {mutationError && (
              <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>La operación no se completó</AlertTitle><AlertDescription>{mutationError}</AlertDescription></Alert>
            )}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Datos compartidos</h3>
              <div className="rounded-md border px-3">
                <DetailRow label="Fecha">{formatDate(viaje.fecha)}</DetailRow>
                <DetailRow label="Vehículo">{viaje.vehiculoModelo ?? `Vehículo #${viaje.vehiculoId}`}</DetailRow>
                <DetailRow label="Chofer">{viaje.choferNombre ?? `Personal #${viaje.choferId}`}</DetailRow>
                <DetailRow label="Ayudante">{viaje.ayudanteNombre ?? "—"}</DetailRow>
                <DetailRow label="Distancia">{viaje.distanciaTotalKm != null ? `${viaje.distanciaTotalKm} km` : "—"}</DetailRow>
                <DetailRow label="Peajes">{viaje.totalPeajesEstimado != null ? `$${Number(viaje.totalPeajesEstimado).toFixed(2)}` : "—"}</DetailRow>
                <DetailRow label="Notas">{viaje.notas || "—"}</DetailRow>
              </div>
            </section>
            <section>
              <div className="mb-2 flex items-end justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Paradas</h3>
                  <p className="text-sm text-muted-foreground">Los recursos se administran desde el viaje, no desde cada parada.</p>
                </div>
                <Badge variant="secondary">{viaje.despachos.length}</Badge>
              </div>
              <div className="rounded-md border divide-y">
                {viaje.despachos.map((dispatch, index) => (
                  <ViajeStop
                    key={dispatch.id}
                    dispatch={dispatch}
                    index={index}
                    isDetaching={updateDispatch.isPending}
                    onDetach={() => detach(dispatch.id)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
