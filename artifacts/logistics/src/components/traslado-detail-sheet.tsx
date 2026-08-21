import React, { useEffect, useState } from "react";
import {
  useGetTraslado,
  getGetTrasladoQueryKey,
  getListTrasladosQueryKey,
  useUpdateTraslado,
  useRegisterDispatchActa,
  useConfirmDispatchActa,
  useListPersonnel,
  getListPersonnelQueryKey,
} from "@workspace/api-client-react";
import type {
  TrasladoSummary,
  TrasladoDetail,
  TrasladoLinea,
  ActaLlegada,
  Personnel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  Loader2,
  Package,
  ArrowRight,
  ClipboardCheck,
  Clock,
} from "lucide-react";
import { formatTrasladoMedida } from "@/lib/traslado-medidas";
import { TrasladoStatusBadge } from "@/lib/traslado-status";
import { toDatetimeLocal } from "@/lib/datetime-local";

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LineasTable({ lines }: { lines: TrasladoLinea[] }) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground gap-2">
        <Package className="w-8 h-8 opacity-40" />
        <p className="text-sm">No hay líneas registradas para este traslado.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/50">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs">Producto</TableHead>
            <TableHead className="text-xs text-right">Demanda</TableHead>
            <TableHead className="text-xs text-right">Cantidad</TableHead>
            <TableHead className="text-xs text-right">Diferencia</TableHead>
            <TableHead className="text-xs text-right">Unidad</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, idx) => {
            const hasDiferencia = line.diferencia !== 0;
            return (
              <TableRow 
                key={`${line.productoId || idx}-${line.codigo}`} 
                className={hasDiferencia ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-muted/30"}
              >
                <TableCell className="min-w-0">
                  <div className="flex flex-col">
                    <span className="block truncate max-w-[220px] font-medium" title={line.descripcion}>
                      {line.descripcion}
                    </span>
                    {line.codigo && <span className="text-[10px] text-muted-foreground font-mono">{line.codigo}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right">{line.demanda}</TableCell>
                <TableCell className="text-right font-medium">{line.cantidad}</TableCell>
                <TableCell className={`text-right ${hasDiferencia ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                  {line.diferencia}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{line.unidad ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const DISPATCH_LABELS: Record<string, string> = {
  "pre-despacho": "Pre-despacho",
  aprobado: "Aprobado",
  "en-ruta": "En ruta",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

/** Dispatch states in which the driver can register an arrival record. */
const ARRIVAL_ELIGIBLE_STATES = new Set(["en-ruta", "entregado"]);

interface ActaCardProps {
  despacho: { id: number; estado: string };
  acta: ActaLlegada | null;
  personnel: Personnel[];
  onSaved: () => void;
}

function personName(personnel: Personnel[], personId: number | null) {
  if (personId === null) return "Usuario no vinculado";
  return personnel.find((person) => person.id === personId)?.nombre ?? `Personal #${personId}`;
}

function ActaCard({ despacho, acta, personnel, onSaved }: ActaCardProps) {
  const { toast } = useToast();
  const registerActa = useRegisterDispatchActa();
  const confirmActa = useConfirmDispatchActa();

  // Arrival (driver half) form state
  const [editingLlegada, setEditingLlegada] = useState(false);
  const [fechaLlegada, setFechaLlegada] = useState("");
  const [novedadesViaje, setNovedadesViaje] = useState("");
  const [llegadaError, setLlegadaError] = useState<string | null>(null);

  // Reception (warehouse half) form state
  const [editingRecepcion, setEditingRecepcion] = useState(false);
  const [recibidoPor, setRecibidoPor] = useState("");
  const [novedadesRecepcion, setNovedadesRecepcion] = useState("");
  const [recepcionError, setRecepcionError] = useState<string | null>(null);

  const now = new Date();
  const maxDatetime = toDatetimeLocal(now);

  useEffect(() => {
    setEditingLlegada(false);
    setEditingRecepcion(false);
    setLlegadaError(null);
    setRecepcionError(null);
  }, [despacho.id, acta?.id]);

  function beginLlegadaEdit() {
    setFechaLlegada(toDatetimeLocal(acta?.fechaLlegada ?? new Date()));
    setNovedadesViaje(acta?.novedadesViaje ?? "");
    setLlegadaError(null);
    setEditingLlegada(true);
  }

  function submitLlegada() {
    if (!fechaLlegada) {
      setLlegadaError("Indica la fecha y hora de llegada.");
      return;
    }
    const parsed = new Date(fechaLlegada);
    if (Number.isNaN(parsed.getTime())) {
      setLlegadaError("Fecha de llegada inválida.");
      return;
    }
    if (parsed.getTime() > Date.now()) {
      setLlegadaError("La llegada no puede ser en el futuro.");
      return;
    }
    const trimmedNovedades = novedadesViaje.trim();
    registerActa.mutate(
      {
        id: despacho.id,
        data: {
          fechaLlegada: parsed.toISOString(),
          novedadesViaje: trimmedNovedades ? trimmedNovedades : null,
        },
      },
      {
        onSuccess: () => {
          setEditingLlegada(false);
          setLlegadaError(null);
          toast({ title: acta ? "Llegada actualizada" : "Llegada registrada" });
          onSaved();
        },
        onError: (mutationError) => {
          setLlegadaError(
            mutationError instanceof Error ? mutationError.message : "No se pudo registrar la llegada.",
          );
        },
      },
    );
  }

  function beginRecepcionEdit() {
    setRecibidoPor(acta?.recibidoPor ?? "");
    setNovedadesRecepcion(acta?.novedadesRecepcion ?? "");
    setRecepcionError(null);
    setEditingRecepcion(true);
  }

  function submitRecepcion() {
    const trimmedRecibido = recibidoPor.trim();
    const trimmedNovedades = novedadesRecepcion.trim();
    confirmActa.mutate(
      {
        id: despacho.id,
        data: {
          recibidoPor: trimmedRecibido ? trimmedRecibido : null,
          novedadesRecepcion: trimmedNovedades ? trimmedNovedades : null,
        },
      },
      {
        onSuccess: () => {
          setEditingRecepcion(false);
          setRecepcionError(null);
          toast({ title: "Recepción confirmada" });
          onSaved();
        },
        onError: (mutationError) => {
          setRecepcionError(
            mutationError instanceof Error ? mutationError.message : "No se pudo confirmar la recepción.",
          );
        },
      },
    );
  }

  const arrivalEligible = ARRIVAL_ELIGIBLE_STATES.has(despacho.estado);
  const estadoLabel = DISPATCH_LABELS[despacho.estado] ?? despacho.estado;

  return (
    <div className="mb-6 rounded-md border border-border/60 bg-muted/10 p-4" data-testid="card-acta-llegada">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardCheck className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Acta de llegada</h3>
      </div>

      {!acta && !arrivalEligible ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground" data-testid="text-acta-pendiente">
          <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {despacho.estado === "cancelado"
              ? "El despacho fue cancelado; no se registrará un acta de llegada."
              : `El despacho está en estado "${estadoLabel}". El acta se podrá registrar cuando llegue a destino.`}
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Arrival (driver) section */}
          {editingLlegada ? (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase text-muted-foreground">Fecha y hora de llegada</label>
              <Input
                type="datetime-local"
                max={maxDatetime}
                value={fechaLlegada}
                onChange={(event) => setFechaLlegada(event.target.value)}
                className="h-8 max-w-56"
                data-testid="input-fecha-llegada"
              />
              <label className="text-[11px] font-semibold uppercase text-muted-foreground block pt-1">Novedades del viaje</label>
              <Textarea
                value={novedadesViaje}
                onChange={(event) => setNovedadesViaje(event.target.value)}
                placeholder="Opcional"
                className="min-h-16 text-sm"
                data-testid="input-novedades-viaje"
              />
              {llegadaError && <p className="text-xs text-destructive">{llegadaError}</p>}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={submitLlegada}
                  disabled={registerActa.isPending}
                  data-testid="button-guardar-llegada"
                >
                  {registerActa.isPending && <Loader2 className="animate-spin" />}
                  Guardar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingLlegada(false)}
                  disabled={registerActa.isPending}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : acta ? (
            <div className="space-y-1.5 text-xs">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <span className="font-medium text-foreground/70">Llegada</span>
                <span data-testid="text-fecha-llegada">{formatDateTime(acta.fechaLlegada)}</span>
                <span className="font-medium text-foreground/70">Novedades del viaje</span>
                <span className={acta.novedadesViaje ? "" : "text-muted-foreground italic"} data-testid="text-novedades-viaje">
                  {acta.novedadesViaje || "Sin novedades"}
                </span>
                <span className="font-medium text-foreground/70">Registrada por</span>
                <span data-testid="text-registrada-por">
                  {personName(personnel, acta.registradaPorId)}
                </span>
              </div>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto min-h-0 p-0 text-xs"
                onClick={beginLlegadaEdit}
                data-testid="button-editar-llegada"
              >
                Corregir llegada
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Aún no se ha registrado la llegada de este despacho.</p>
              <Button
                type="button"
                size="sm"
                onClick={beginLlegadaEdit}
                data-testid="button-registrar-llegada"
              >
                Registrar llegada
              </Button>
            </div>
          )}

          {/* Reception (warehouse) section — only once arrival exists */}
          {acta && (
            <div className="border-t border-border/50 pt-3">
              {editingRecepcion ? (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase text-muted-foreground">Recibido por</label>
                  <Input
                    value={recibidoPor}
                    onChange={(event) => setRecibidoPor(event.target.value)}
                    placeholder="Nombre de quien recibe"
                    className="h-8 max-w-64"
                    data-testid="input-recibido-por"
                  />
                  <label className="text-[11px] font-semibold uppercase text-muted-foreground block pt-1">Novedades de recepción</label>
                  <Textarea
                    value={novedadesRecepcion}
                    onChange={(event) => setNovedadesRecepcion(event.target.value)}
                    placeholder="Opcional"
                    className="min-h-16 text-sm"
                    data-testid="input-novedades-recepcion"
                  />
                  {recepcionError && <p className="text-xs text-destructive">{recepcionError}</p>}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitRecepcion}
                      disabled={confirmActa.isPending}
                      data-testid="button-guardar-recepcion"
                    >
                      {confirmActa.isPending && <Loader2 className="animate-spin" />}
                      Guardar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingRecepcion(false)}
                      disabled={confirmActa.isPending}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : acta.confirmadaAt ? (
                <div className="space-y-1.5 text-xs">
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <span className="font-medium text-foreground/70">Recibido por</span>
                    <span className={acta.recibidoPor ? "" : "text-muted-foreground italic"} data-testid="text-recibido-por">
                      {acta.recibidoPor || "No especificado"}
                    </span>
                    <span className="font-medium text-foreground/70">Novedades de recepción</span>
                    <span className={acta.novedadesRecepcion ? "" : "text-muted-foreground italic"} data-testid="text-novedades-recepcion">
                      {acta.novedadesRecepcion || "Sin novedades"}
                    </span>
                    <span className="font-medium text-foreground/70">Confirmada</span>
                    <span className="text-muted-foreground" data-testid="text-confirmada-at">{formatDateTime(acta.confirmadaAt)}</span>
                    <span className="font-medium text-foreground/70">Confirmada por</span>
                    <span data-testid="text-confirmada-por">
                      {personName(personnel, acta.confirmadaPorId)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto min-h-0 p-0 text-xs"
                    onClick={beginRecepcionEdit}
                    data-testid="button-editar-recepcion"
                  >
                    Corregir recepción
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">La recepción en almacén aún no se ha confirmado.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={beginRecepcionEdit}
                    data-testid="button-confirmar-recepcion"
                  >
                    Confirmar recepción
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TrasladoDetailSheetProps {
  traslado: TrasladoSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TrasladoDetailSheet({ traslado: trasladoProp, open, onOpenChange }: TrasladoDetailSheetProps) {
  if (!trasladoProp) return null;
  return <TrasladoDetailSheetInner trasladoSummary={trasladoProp} open={open} onOpenChange={onOpenChange} />;
}

function TrasladoDetailSheetInner({ trasladoSummary, open, onOpenChange }: { trasladoSummary: TrasladoSummary; open: boolean; onOpenChange: (open: boolean) => void; }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateTraslado = useUpdateTraslado();
  const { data: personnel } = useListPersonnel({
    query: { queryKey: getListPersonnelQueryKey() },
  });
  const [editingPeso, setEditingPeso] = useState(false);
  const [pesoInput, setPesoInput] = useState("");
  const [pesoError, setPesoError] = useState<string | null>(null);
  const { data: detailData, isLoading, error } = useGetTraslado(trasladoSummary.id, {
    query: { queryKey: getGetTrasladoQueryKey(trasladoSummary.id) }
  });

  const traslado = detailData || (trasladoSummary as TrasladoDetail);

  useEffect(() => {
    setEditingPeso(false);
    setPesoInput("");
    setPesoError(null);
  }, [trasladoSummary.id, open]);

  function bustTrasladoCache() {
    queryClient.removeQueries({ queryKey: getGetTrasladoQueryKey(trasladoSummary.id) });
    queryClient.invalidateQueries({ queryKey: getGetTrasladoQueryKey(trasladoSummary.id) });
    queryClient.removeQueries({ queryKey: getListTrasladosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTrasladosQueryKey() });
  }

  function beginPesoEdit() {
    setPesoInput(detailData?.pesoEstimadoKg?.toString() ?? "");
    setPesoError(null);
    setEditingPeso(true);
  }

  function savePesoEstimado(value: number | null) {
    updateTraslado.mutate(
      { id: trasladoSummary.id, data: { pesoEstimadoKg: value } },
      {
        onSuccess: () => {
          bustTrasladoCache();
          setEditingPeso(false);
          setPesoError(null);
          toast({ title: value === null ? "Estimación eliminada" : "Peso estimado guardado" });
        },
        onError: (mutationError) => {
          setPesoError(
            mutationError instanceof Error
              ? mutationError.message
              : "No se pudo guardar la estimación.",
          );
        },
      },
    );
  }

  function submitPeso() {
    const trimmed = pesoInput.trim();
    if (!trimmed) {
      savePesoEstimado(null);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value <= 0) {
      setPesoError("Ingresa un peso mayor que cero.");
      return;
    }
    savePesoEstimado(value);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden"
      >
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border space-y-4">
          <SheetHeader>
            <SheetTitle className="min-w-0 flex items-center gap-2">
              <span className="block truncate" title={`Traslado #${traslado.id}`}>
                Traslado {traslado.referencia || `#${traslado.id}`}
              </span>
              {traslado.mismoAlmacen && (
                <Badge variant="secondary" className="text-[10px] uppercase font-bold text-muted-foreground">
                  Interno
                </Badge>
              )}
              {traslado.cruzaPlaza && (
                <Badge variant="outline" className="border-purple-500/50 text-purple-600 dark:text-purple-400 bg-purple-500/10 text-[10px] px-1.5 py-0">
                  Cruza Plaza
                </Badge>
              )}
              <TrasladoStatusBadge
                estadoLogistico={traslado.estadoLogistico}
                estadoOdoo={traslado.estadoOdoo}
              />
            </SheetTitle>
          </SheetHeader>

          <div className="flex items-center gap-4 text-sm bg-muted/20 p-3 rounded-md border border-border/50">
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase mb-0.5">Origen</p>
              <p className="font-medium truncate" title={traslado.almacenOrigen?.nombre || "—"}>
                {traslado.almacenOrigen?.nombre || "—"}
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase mb-0.5">Destino</p>
              <p className="font-medium truncate" title={traslado.almacenDestino?.nombre || "—"}>
                {traslado.almacenDestino?.nombre || "—"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">Fecha programada</span>
            <span>{formatDate(traslado.fechaProgramada)}</span>

            <span className="font-medium text-foreground/70">Fecha efectiva</span>
            <span>{formatDate(traslado.fechaEfectiva)}</span>

            <span className="font-medium text-foreground/70">Peso</span>
            <div className="min-w-0">
              {editingPeso ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={pesoInput}
                      onChange={(event) => setPesoInput(event.target.value)}
                      placeholder="Peso en kg"
                      className="h-8 max-w-36"
                      data-testid="input-peso-estimado"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitPeso}
                      disabled={updateTraslado.isPending}
                      data-testid="button-guardar-peso-estimado"
                    >
                      {updateTraslado.isPending && <Loader2 className="animate-spin" />}
                      Guardar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingPeso(false)}
                      disabled={updateTraslado.isPending}
                    >
                      Cancelar
                    </Button>
                  </div>
                  {traslado.origenPeso === "estimado" && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-0 p-0 text-xs text-muted-foreground"
                      onClick={() => savePesoEstimado(null)}
                      disabled={updateTraslado.isPending}
                    >
                      Eliminar estimación
                    </Button>
                  )}
                  {pesoError && <p className="text-xs text-destructive">{pesoError}</p>}
                </div>
              ) : traslado.origenPeso === "odoo" ? (
                <span className="text-foreground">
                  {formatTrasladoMedida(traslado.pesoEfectivoKg, "kg")}
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground italic">
                    {traslado.origenPeso === "estimado"
                      ? `${formatTrasladoMedida(traslado.pesoEfectivoKg, "kg")} (estimado)`
                      : "sin dato en Odoo"}
                  </span>
                  {!isLoading && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-0 p-0 text-xs"
                      onClick={beginPesoEdit}
                      data-testid="button-editar-peso-estimado"
                    >
                      {traslado.origenPeso === "estimado" ? "Editar" : "Agregar estimación"}
                    </Button>
                  )}
                </div>
              )}
            </div>

            <span className="font-medium text-foreground/70">Volumen</span>
            <span className={traslado.volumenCalculadoM3 == null ? "text-muted-foreground italic" : "text-foreground"}>
              {formatTrasladoMedida(traslado.volumenCalculadoM3, "m³")}
            </span>
          </div>

        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {detailData?.despachoActivo && (
            <ActaCard
              despacho={detailData.despachoActivo}
              acta={detailData?.acta ?? null}
              personnel={personnel ?? []}
              onSaved={bustTrasladoCache}
            />
          )}

          <h3 className="text-sm font-bold text-foreground mb-4">Líneas del Traslado</h3>
          
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive mt-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{(error as any)?.response?.data?.error ?? (error as Error)?.message ?? "Error al cargar las líneas del traslado."}</span>
            </div>
          ) : (
            <LineasTable lines={detailData?.lineas || []} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}