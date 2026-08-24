import React, { useEffect, useMemo, useState } from "react";
import {
  type Dispatch,
  type DispatchInput,
  type Personnel,
  type Vehicle,
  useCreateDispatch,
  useCreateViaje,
  useDeleteDispatch,
  useUpdateViaje,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Route, Trash2, Truck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { refreshViajeOperationalData } from "@/lib/viaje-cache";
import { toDatetimeLocal } from "@/lib/datetime-local";
import {
  cargoEstimateDraftValid,
  DispatchCargoEstimateEditor,
  effectiveCargoMeasure,
  parsePositiveEstimate,
  type DispatchCargoEstimateDraft,
} from "@/components/dispatch-cargo-estimate-editor";

export type ViajeSelectedOrder = {
  key: string;
  tipo: "venta" | "traslado";
  id: number;
  titulo: string;
  subtitulo: string;
  pesoKg: number | null;
  volumenM3: number | null;
};

type CreationIssue = {
  message: string;
  createdDispatches: Array<{ id: number; orderTitle: string }>;
  failedOrderTitle?: string;
};

interface ViajeWizardProps {
  open: boolean;
  orders: ViajeSelectedOrder[];
  vehicles: Vehicle[];
  personnel: Personnel[];
  existingDispatches: Dispatch[];
  onOpenChange: (open: boolean) => void;
  onRemove: (key: string) => void;
  onCreated: (viajeId: number, warning?: string) => void;
  onPartialFailureClose: () => void;
}

function formatKnownTotal(total: number, hasUnknown: boolean, unit: "kg" | "m³") {
  const value = `${total} ${unit}`;
  return hasUnknown ? `${value} conocidos · datos incompletos` : value;
}

function defaultTripDateTimes() {
  const departure = new Date();
  const arrival = new Date(departure);
  arrival.setDate(arrival.getDate() + 1);
  return {
    departure: toDatetimeLocal(departure),
    arrival: toDatetimeLocal(arrival),
  };
}

function formatDispatchDate(s: string) {
  return new Date(s).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ViajeWizard({
  open,
  orders,
  vehicles,
  personnel,
  existingDispatches,
  onOpenChange,
  onRemove,
  onCreated,
  onPartialFailureClose,
}: ViajeWizardProps) {
  const queryClient = useQueryClient();
  const createDispatch = useCreateDispatch();
  const deleteCreatedDispatch = useDeleteDispatch();
  const createViaje = useCreateViaje();
  const updateViaje = useUpdateViaje();
  const [vehiculoId, setVehiculoId] = useState("");
  const [choferId, setChoferId] = useState("");
  const [ayudanteId, setAyudanteId] = useState("0");
  const [fechaSalida, setFechaSalida] = useState(() => defaultTripDateTimes().departure);
  const [fechaLlegada, setFechaLlegada] = useState(() => defaultTripDateTimes().arrival);
  const [distanciaKm, setDistanciaKm] = useState("100");
  const [peajes, setPeajes] = useState("");
  const [notas, setNotas] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creationIssue, setCreationIssue] = useState<CreationIssue | null>(null);
  const [estimateDrafts, setEstimateDrafts] = useState<Record<string, DispatchCargoEstimateDraft>>({});

  const carga = useMemo(() => {
    const effective = orders.map((order) => {
      const draft = estimateDrafts[order.key] ?? { peso: "", volumen: "" };
      return {
        pesoKg: effectiveCargoMeasure(order.pesoKg, draft.peso, order.tipo === "venta"),
        volumenM3: effectiveCargoMeasure(order.volumenM3, draft.volumen, order.tipo === "venta"),
      };
    });
    const pesoKnown = effective.reduce((total, order) => total + (order.pesoKg ?? 0), 0);
    const volumenKnown = effective.reduce((total, order) => total + (order.volumenM3 ?? 0), 0);
    return {
      pesoKnown,
      volumenKnown,
      pesoUnknown: effective.some((order) => order.pesoKg === null),
      volumenUnknown: effective.some((order) => order.volumenM3 === null),
    };
  }, [orders, estimateDrafts]);
  const estimatesValid = orders.every((order) =>
    cargoEstimateDraftValid(estimateDrafts[order.key] ?? { peso: "", volumen: "" }),
  );
  const vehicle = vehicles.find((item) => item.id === Number(vehiculoId));
  const capacityExceeded = Boolean(
    vehicle
    && (carga.pesoKnown > vehicle.capacidadPeso || carga.volumenKnown > vehicle.capacidadVolumen),
  );
  const BUSY_STATES = ["pre-despacho", "aprobado", "en-ruta"];
  const vehicleConflict = (() => {
    if (!vehiculoId || !fechaSalida || !fechaLlegada) return null;
    const newStart = new Date(fechaSalida).getTime();
    const newEnd = new Date(fechaLlegada).getTime();
    return existingDispatches.find((dispatch) =>
      dispatch.vehiculoId === Number(vehiculoId)
      && BUSY_STATES.includes(dispatch.estado)
      && newStart < new Date(dispatch.fechaEstimadaLlegada).getTime()
      && newEnd > new Date(dispatch.fechaEstimadaSalida).getTime()
    ) ?? null;
  })();
  const isSubmitting = createDispatch.isPending || createViaje.isPending || updateViaje.isPending;

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setCreationIssue(null);
    if (!fechaSalida || !fechaLlegada) {
      const defaults = defaultTripDateTimes();
      if (!fechaSalida) setFechaSalida(defaults.departure);
      if (!fechaLlegada) setFechaLlegada(defaults.arrival);
    }
    setEstimateDrafts((current) => Object.fromEntries(
      orders.map((order) => [order.key, current[order.key] ?? { peso: "", volumen: "" }]),
    ));
  }, [open, orders]);

  function close() {
    if (isSubmitting) return;
    if (creationIssue?.createdDispatches.length) {
      onPartialFailureClose();
      return;
    }
    onOpenChange(false);
  }

  async function submit() {
    setFormError(null);
    setCreationIssue(null);
    const distance = Number(distanciaKm);
    const tolls = peajes.trim() ? Number(peajes) : null;
    if (!orders.length) {
      setFormError("Selecciona al menos una orden para el viaje.");
      return;
    }
    if (!vehiculoId || !choferId || !fechaSalida || !fechaLlegada || !distanciaKm) {
      setFormError("Indica vehículo, chofer, salida, llegada y distancia.");
      return;
    }
    if (vehicleConflict) {
      const vehicleName = vehicleConflict.vehiculoModelo ?? vehicle?.modelo ?? "El vehículo seleccionado";
      setFormError(
        `${vehicleName} ya está comprometido en el despacho #${vehicleConflict.id} durante ese período. Cambia el vehículo o ajusta el horario.`,
      );
      return;
    }
    if (new Date(fechaLlegada).getTime() <= new Date(fechaSalida).getTime()) {
      setFormError("La llegada debe ser posterior a la salida.");
      return;
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      setFormError("La distancia debe ser mayor que cero.");
      return;
    }
    if (tolls !== null && (!Number.isFinite(tolls) || tolls < 0)) {
      setFormError("Los peajes no pueden ser negativos.");
      return;
    }
    if (capacityExceeded) {
      setFormError("La carga conocida supera la capacidad del vehículo seleccionado.");
      return;
    }
    if (!estimatesValid) {
      setFormError("Las estimaciones deben ser mayores que cero o quedar vacías.");
      return;
    }

    const common = {
      vehiculoId: Number(vehiculoId),
      choferId: Number(choferId),
      ...(ayudanteId !== "0" ? { ayudanteId: Number(ayudanteId) } : {}),
      fechaEstimadaSalida: fechaSalida,
      fechaEstimadaLlegada: fechaLlegada,
      distanciaKm: distance,
      distanciaManual: true,
    };
    const createdDispatches: Array<{ id: number; orderTitle: string }> = [];
    const cleanupCreatedDispatches = async () => {
      const results = await Promise.allSettled(
        createdDispatches.map(({ id }) => deleteCreatedDispatch.mutateAsync({ id })),
      );
      return results.every((result) => result.status === "fulfilled");
    };

    for (const order of orders) {
      try {
        const estimateDraft = estimateDrafts[order.key] ?? { peso: "", volumen: "" };
        const pesoEstimadoKg = parsePositiveEstimate(estimateDraft.peso);
        const volumenEstimadoM3 = parsePositiveEstimate(estimateDraft.volumen);
        const payload: DispatchInput = order.tipo === "venta"
          ? {
              ...common,
              tipo: "venta",
              ventaId: order.id,
              ruta: order.subtitulo,
              ...(pesoEstimadoKg ? { pesoEstimadoKg } : {}),
              ...(volumenEstimadoM3 ? { volumenEstimadoM3 } : {}),
            }
          : {
              ...common,
              tipo: "traslado",
              trasladoId: order.id,
              ruta: order.subtitulo,
              ...(pesoEstimadoKg ? { pesoEstimadoKg } : {}),
              ...(volumenEstimadoM3 ? { volumenEstimadoM3 } : {}),
            };
        const dispatch = await createDispatch.mutateAsync({ data: payload });
        createdDispatches.push({ id: dispatch.id, orderTitle: order.titulo });
      } catch (error) {
        const dispatchIds = createdDispatches.map((dispatch) => dispatch.id);
        const cleanedUp = await cleanupCreatedDispatches();
        refreshViajeOperationalData(queryClient, { dispatchIds });
        setCreationIssue({
          createdDispatches: cleanedUp ? [] : createdDispatches,
          failedOrderTitle: order.titulo,
          message: `${error instanceof Error ? error.message : "El servidor rechazó uno de los despachos."}${
            cleanedUp
              ? " Los despachos creados durante este intento fueron eliminados."
              : " No se pudieron eliminar todos los despachos creados durante este intento."
          }`,
        });
        return;
      }
    }

    const createdDispatchIds = createdDispatches.map((dispatch) => dispatch.id);
    try {
      const viaje = await createViaje.mutateAsync({
        data: {
          vehiculoId: common.vehiculoId,
          choferId: common.choferId,
          ...(ayudanteId !== "0" ? { ayudanteId: Number(ayudanteId) } : {}),
          fecha: fechaSalida.slice(0, 10),
          despachoIds: createdDispatchIds,
          notas: notas.trim() || null,
        },
      });
      try {
        await updateViaje.mutateAsync({
          id: viaje.id,
          data: {
            distanciaTotalKm: common.distanciaKm,
            totalPeajesEstimado: tolls,
          },
        });
      } catch (error) {
        refreshViajeOperationalData(queryClient, { viajeId: viaje.id, dispatchIds: createdDispatchIds });
        onCreated(
          viaje.id,
          `El viaje quedó agrupado, pero no se pudieron guardar distancia y peajes: ${error instanceof Error ? error.message : "error desconocido"}`,
        );
        return;
      }
      refreshViajeOperationalData(queryClient, { viajeId: viaje.id, dispatchIds: createdDispatchIds });
      onCreated(viaje.id);
    } catch (error) {
      const cleanedUp = await cleanupCreatedDispatches();
      refreshViajeOperationalData(queryClient, { dispatchIds: createdDispatchIds });
      setCreationIssue({
        createdDispatches: cleanedUp ? [] : createdDispatches,
        message: `${error instanceof Error ? error.message : "No se pudo agrupar los despachos creados."}${
          cleanedUp
            ? " Los despachos creados durante este intento fueron eliminados."
            : " No se pudieron eliminar todos los despachos creados durante este intento."
        }`,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? undefined : close())}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-4xl max-h-[90vh] min-w-0 overflow-x-hidden overflow-y-auto">
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <Route className="h-5 w-5 text-primary" />
            <span className="min-w-0 truncate">Confirmar viaje compartido</span>
          </DialogTitle>
        </DialogHeader>

        {creationIssue ? (
          <Alert variant="destructive" className="min-w-0 break-words" data-testid="alert-viaje-partial-failure">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Hay despachos sueltos que requieren atención</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{creationIssue.message}</p>
              {creationIssue.failedOrderTitle && (
                <p>La creación se detuvo en: <strong>{creationIssue.failedOrderTitle}</strong>.</p>
              )}
              {creationIssue.createdDispatches.length > 0 ? (
                <div>
                  <p>Despachos creados sin agrupar:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {creationIssue.createdDispatches.map((dispatch) => (
                      <li key={dispatch.id}>#{dispatch.id} — {dispatch.orderTitle}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>No se creó ningún despacho.</p>
              )}
              <p>No se intentó agrupar parcialmente. Revisa esos despachos antes de volver a intentar.</p>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <section className="min-w-0 space-y-3">
                <div>
                  <h3 className="font-semibold">Órdenes seleccionadas</h3>
                  <p className="text-sm text-muted-foreground">Puedes retirar una orden antes de crear los despachos.</p>
                </div>
                <div className="max-h-[330px] overflow-y-auto rounded-md border divide-y">
                  {orders.map((order) => (
                    <div key={order.key} className="space-y-3 p-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={order.titulo}>{order.titulo}</p>
                          <p className="truncate text-xs text-muted-foreground" title={order.subtitulo}>{order.subtitulo}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {order.pesoKg == null ? "Peso: sin dato" : `Peso: ${order.pesoKg} kg`}
                            {" · "}
                            {order.volumenM3 == null ? "Volumen: sin dato" : `Volumen: ${order.volumenM3} m³`}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="shrink-0"
                          onClick={() => onRemove(order.key)}
                          disabled={isSubmitting}
                          aria-label={`Retirar ${order.titulo}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <DispatchCargoEstimateEditor
                        pesoOdooKg={order.pesoKg}
                        volumenOdooM3={order.volumenM3}
                        draft={estimateDrafts[order.key] ?? { peso: "", volumen: "" }}
                        onChange={(draft) => setEstimateDrafts((current) => ({
                          ...current,
                          [order.key]: draft,
                        }))}
                        disabled={isSubmitting}
                        zeroMeansMissing={order.tipo === "venta"}
                        compact
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section className="min-w-0 space-y-4">
                <div className="grid min-w-0 grid-cols-2 gap-3">
                  <div className="col-span-2 min-w-0 space-y-2">
                    <Label>Vehículo</Label>
                    <Select value={vehiculoId} onValueChange={setVehiculoId} disabled={isSubmitting}>
                      <SelectTrigger data-testid="select-viaje-vehiculo"><SelectValue placeholder="Seleccionar vehículo" /></SelectTrigger>
                      <SelectContent>
                        {vehicles.map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {item.modelo} — {item.capacidadPeso} kg / {item.capacidadVolumen} m³
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {vehicleConflict && (
                      <Alert variant="destructive" className="mt-2 min-w-0 break-words" data-testid="alert-viaje-vehicle-conflict">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {vehicleConflict.vehiculoModelo ?? vehicle?.modelo ?? "El vehículo seleccionado"} está ocupado por el despacho #{vehicleConflict.id} del{" "}
                          {formatDispatchDate(vehicleConflict.fechaEstimadaSalida)} al{" "}
                          {formatDispatchDate(vehicleConflict.fechaEstimadaLlegada)}. Cambia el vehículo o ajusta el horario.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label>Chofer</Label>
                    <Select value={choferId} onValueChange={setChoferId} disabled={isSubmitting}>
                      <SelectTrigger data-testid="select-viaje-chofer"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        {personnel.filter((item) => item.rol === "chofer").map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>{item.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label>Ayudante <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                    <Select value={ayudanteId} onValueChange={setAyudanteId} disabled={isSubmitting}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Ninguno</SelectItem>
                        {personnel.filter((item) => item.rol === "ayudante").map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>{item.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label>Salida</Label>
                    <Input type="datetime-local" value={fechaSalida} onChange={(event) => setFechaSalida(event.target.value)} disabled={isSubmitting} data-testid="input-viaje-salida" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label>Llegada</Label>
                    <Input type="datetime-local" value={fechaLlegada} onChange={(event) => setFechaLlegada(event.target.value)} disabled={isSubmitting} data-testid="input-viaje-llegada" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label>Distancia (km)</Label>
                    <Input type="number" min="0.1" step="any" value={distanciaKm} onChange={(event) => setDistanciaKm(event.target.value)} disabled={isSubmitting} />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label>Peajes estimados <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                    <Input type="number" min="0" step="any" value={peajes} onChange={(event) => setPeajes(event.target.value)} disabled={isSubmitting} />
                  </div>
                </div>
                <div className="min-w-0 space-y-2">
                  <Label>Notas <span className="font-normal text-muted-foreground">(opcionales)</span></Label>
                  <Textarea value={notas} onChange={(event) => setNotas(event.target.value)} disabled={isSubmitting} placeholder="Indicaciones comunes del viaje" />
                </div>
              </section>
            </div>

            <div className={`min-w-0 rounded-md border p-3 text-sm ${capacityExceeded ? "border-destructive/60 bg-destructive/10" : "bg-muted/40"}`} data-testid="viaje-load-summary">
              <div className="flex items-center gap-2 font-medium">
                <Truck className="h-4 w-4 text-primary" />
                Carga combinada: {orders.length} {orders.length === 1 ? "orden" : "órdenes"}
              </div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2 text-muted-foreground">
                <span>Peso: {formatKnownTotal(carga.pesoKnown, carga.pesoUnknown, "kg")}</span>
                <span>Volumen: {formatKnownTotal(carga.volumenKnown, carga.volumenUnknown, "m³")}</span>
              </div>
              {vehicle && (
                <p className={`mt-2 text-xs ${capacityExceeded ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  Capacidad del vehículo: {vehicle.capacidadPeso} kg / {vehicle.capacidadVolumen} m³.
                  {capacityExceeded ? " La carga conocida excede la capacidad; no puedes crear el viaje." : ""}
                </p>
              )}
            </div>
            {formError && <p className="break-words text-sm text-destructive" data-testid="text-viaje-form-error">{formError}</p>}
          </>
        )}

        <div className="flex min-w-0 flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={close} disabled={isSubmitting}>
            {creationIssue ? "Cerrar" : "Cancelar"}
          </Button>
          {!creationIssue && (
            <Button type="button" className="w-full sm:w-auto" onClick={submit} disabled={isSubmitting || capacityExceeded || !estimatesValid || Boolean(vehicleConflict) || orders.length === 0} data-testid="button-confirmar-viaje">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear viaje y {orders.length} {orders.length === 1 ? "despacho" : "despachos"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
