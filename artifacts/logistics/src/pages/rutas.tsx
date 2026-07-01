import React, { useState } from "react";
import {
  useListRoutes, getListRoutesQueryKey,
  useCreateRoute,
  useUpdateRoute,
  useDeleteRoute,
  useAddRouteToll,
  useUpdateRouteToll,
  useDeleteRouteToll,
  useAddRouteWaypoint,
  useDeleteRouteWaypoint,
  useUpdateRouteWaypoint,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Star, Plus, Trash2, Loader2, MapPin, ArrowRight, Navigation, Edit2, X, Route as RouteIcon,
  ChevronUp, ChevronDown
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type RouteType = "sencillo" | "redondo" | "multidestino";
type RouteItem = {
  id: number;
  nombre: string;
  tipo: string;
  origen: string;
  destino: string;
  distanciaKm: number | null;
  favorita: boolean;
  tolls: { id: number; routeId: number; nombre: string; orden: number; tarifa: number }[];
  waypoints: { id: number; routeId: number; ubicacion: string; orden: number }[];
  linkedDispatchCount?: number;
  createdAt?: string;
};

const TIPO_LABEL: Record<string, string> = {
  sencillo: "Sencillo",
  redondo: "Redondo",
  multidestino: "Multidestino",
};

const TIPO_COLOR: Record<string, string> = {
  sencillo: "text-blue-400 border-blue-400/40",
  redondo: "text-purple-400 border-purple-400/40",
  multidestino: "text-orange-400 border-orange-400/40",
};

const routeFormSchema = z.object({
  nombre: z.string().min(1, "Requerido"),
  tipo: z.enum(["sencillo", "redondo", "multidestino"]),
  origen: z.string().min(1, "Requerido"),
  destino: z.string().min(1, "Requerido"),
  distanciaKm: z.coerce.number().min(0).optional(),
});

type RouteFormValues = z.infer<typeof routeFormSchema>;

function RouteCard({
  route,
  onEdit,
  onDelete,
  onToggleFavorite,
}: {
  route: RouteItem;
  onEdit: (route: RouteItem) => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (route: RouteItem) => void;
}) {
  return (
    <Card className="border border-border/60 bg-card/80 hover:border-border transition-colors">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-base text-foreground truncate">
                {route.nombre || `${route.origen} → ${route.destino}`}
              </span>
              <Badge variant="outline" className={`text-xs ${TIPO_COLOR[route.tipo] ?? ""}`}>
                {TIPO_LABEL[route.tipo] ?? route.tipo}
              </Badge>
              {route.favorita && (
                <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 text-sm text-muted-foreground">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{route.origen}</span>
              <ArrowRight className="w-3 h-3 shrink-0" />
              <span className="truncate">{route.destino}</span>
            </div>
            {route.tipo === "multidestino" && route.waypoints.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground/80 pl-5">
                <Navigation className="w-3 h-3" />
                <span>{route.waypoints.length} parada{route.waypoints.length !== 1 ? "s" : ""} intermedias</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => onToggleFavorite(route)}
              title={route.favorita ? "Quitar de favoritas" : "Agregar a favoritas"}
            >
              <Star className={`w-3.5 h-3.5 ${route.favorita ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground"}`} />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(route)}>
              <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDelete(route.id)}>
              <Trash2 className="w-3.5 h-3.5 text-destructive/70" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3 px-4">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {route.distanciaKm != null && (
            <span className="flex items-center gap-1">
              <RouteIcon className="w-3 h-3" />
              {route.distanciaKm} km
            </span>
          )}
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {route.tolls.length} caseta{route.tolls.length !== 1 ? "s" : ""}
          </span>
        </div>
        {route.tolls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {route.tolls.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 text-xs bg-muted/60 rounded px-1.5 py-0.5 text-muted-foreground">
                <MapPin className="w-2.5 h-2.5" />
                {t.nombre}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RouteDialog({
  open,
  route,
  onClose,
}: {
  open: boolean;
  route: RouteItem | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = route !== null;

  const createMutation = useCreateRoute();
  const updateMutation = useUpdateRoute();
  const addTollMutation = useAddRouteToll();
  const updateTollMutation = useUpdateRouteToll();
  const deleteTollMutation = useDeleteRouteToll();
  const addWaypointMutation = useAddRouteWaypoint();
  const deleteWaypointMutation = useDeleteRouteWaypoint();
  const updateWaypointMutation = useUpdateRouteWaypoint();

  const [tollInput, setTollInput] = useState("");
  const [tollTarifaInput, setTollTarifaInput] = useState("");
  const [waypointInput, setWaypointInput] = useState("");
  const [localTolls, setLocalTolls] = useState<{ id: number; nombre: string; orden: number; tarifa: number }[]>([]);
  const [localWaypoints, setLocalWaypoints] = useState<{ id: number; ubicacion: string; orden: number }[]>([]);
  const [savedRouteId, setSavedRouteId] = useState<number | null>(null);

  const form = useForm<RouteFormValues>({
    resolver: zodResolver(routeFormSchema),
    defaultValues: {
      nombre: route?.nombre ?? "",
      tipo: (route?.tipo as RouteType) ?? "sencillo",
      origen: route?.origen ?? "",
      destino: route?.destino ?? "",
      distanciaKm: route?.distanciaKm ?? undefined,
    },
  });

  const tipo = form.watch("tipo");

  React.useEffect(() => {
    if (open) {
      form.reset({
        nombre: route?.nombre ?? "",
        tipo: (route?.tipo as RouteType) ?? "sencillo",
        origen: route?.origen ?? "",
        destino: route?.destino ?? "",
        distanciaKm: route?.distanciaKm ?? undefined,
      });
      setLocalTolls(route?.tolls ?? []);
      setLocalWaypoints(route?.waypoints ?? []);
      setSavedRouteId(route?.id ?? null);
      setTollInput("");
      setTollTarifaInput("");
      setWaypointInput("");
    }
  }, [open, route]);

  const invalidate = () => {
    queryClient.removeQueries({ queryKey: getListRoutesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
  };

  const onSubmit = (values: RouteFormValues) => {
    const payload = {
      nombre: values.nombre,
      tipo: values.tipo,
      origen: values.origen,
      destino: values.destino,
      ...(values.distanciaKm != null ? { distanciaKm: values.distanciaKm } : {}),
    };

    if (isEditing && route) {
      updateMutation.mutate(
        { id: route.id, data: payload },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: "Ruta actualizada" });
            onClose();
          },
        }
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: (created) => {
            setSavedRouteId(created.id);
            setLocalTolls(created.tolls ?? []);
            setLocalWaypoints(created.waypoints ?? []);
            invalidate();
            toast({ title: "Ruta creada" });
            onClose();
          },
        }
      );
    }
  };

  const handleAddToll = () => {
    const name = tollInput.trim();
    if (!name) return;
    const routeId = savedRouteId ?? route?.id;
    if (!routeId) {
      toast({ title: "Guarda la ruta primero para agregar casetas", variant: "destructive" });
      return;
    }
    const tarifa = parseFloat(tollTarifaInput);
    addTollMutation.mutate(
      { id: routeId, data: { nombre: name, ...(Number.isFinite(tarifa) ? { tarifa } : {}) } },
      {
        onSuccess: (newToll) => {
          setLocalTolls((prev) => [...prev, newToll]);
          setTollInput("");
          setTollTarifaInput("");
          invalidate();
        },
      }
    );
  };

  const handleUpdateTollTarifa = (routeId: number, tollId: number, tarifa: number) => {
    if (!Number.isFinite(tarifa) || tarifa < 0) return;
    setLocalTolls((prev) => prev.map((t) => (t.id === tollId ? { ...t, tarifa } : t)));
    updateTollMutation.mutate(
      { routeId, tollId, data: { tarifa } },
      { onSuccess: () => invalidate() }
    );
  };

  const handleDeleteToll = (routeId: number, tollId: number) => {
    deleteTollMutation.mutate(
      { routeId, tollId },
      {
        onSuccess: () => {
          setLocalTolls((prev) => prev.filter((t) => t.id !== tollId));
          invalidate();
        },
      }
    );
  };

  const handleAddWaypoint = () => {
    const loc = waypointInput.trim();
    if (!loc) return;
    const routeId = savedRouteId ?? route?.id;
    if (!routeId) {
      toast({ title: "Guarda la ruta primero para agregar paradas", variant: "destructive" });
      return;
    }
    addWaypointMutation.mutate(
      { id: routeId, data: { ubicacion: loc, orden: localWaypoints.length + 1 } },
      {
        onSuccess: (newWp) => {
          setLocalWaypoints((prev) => [...prev, newWp]);
          setWaypointInput("");
          invalidate();
        },
      }
    );
  };

  const handleDeleteWaypoint = (routeId: number, waypointId: number) => {
    deleteWaypointMutation.mutate(
      { routeId, waypointId },
      {
        onSuccess: () => {
          setLocalWaypoints((prev) => prev.filter((w) => w.id !== waypointId));
          invalidate();
        },
      }
    );
  };

  const handleMoveWaypoint = (index: number, direction: "up" | "down") => {
    const routeId = savedRouteId ?? route?.id;
    if (!routeId) return;
    const sorted = [...localWaypoints].sort((a, b) => a.orden - b.orden);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;

    const wpA = sorted[index];
    const wpB = sorted[swapIndex];
    const ordenA = wpA.orden;
    const ordenB = wpB.orden;

    setLocalWaypoints((prev) =>
      prev.map((w) => {
        if (w.id === wpA.id) return { ...w, orden: ordenB };
        if (w.id === wpB.id) return { ...w, orden: ordenA };
        return w;
      })
    );

    updateWaypointMutation.mutate(
      { routeId, waypointId: wpA.id, data: { orden: ordenB } },
      { onSuccess: () => invalidate() }
    );
    updateWaypointMutation.mutate(
      { routeId, waypointId: wpB.id, data: { orden: ordenA } },
      { onSuccess: () => invalidate() }
    );
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const activeRouteId = savedRouteId ?? route?.id;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar ruta" : "Nueva ruta"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="tipo" render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo de viaje</FormLabel>
                <Tabs value={field.value} onValueChange={field.onChange}>
                  <TabsList className="w-full">
                    <TabsTrigger value="sencillo" className="flex-1">Sencillo</TabsTrigger>
                    <TabsTrigger value="redondo" className="flex-1">Redondo</TabsTrigger>
                    <TabsTrigger value="multidestino" className="flex-1">Multidestino</TabsTrigger>
                  </TabsList>
                </Tabs>
                {(field.value === "redondo" || field.value === "multidestino") && (
                  <p className="text-xs text-amber-500 flex items-start gap-1.5 mt-1.5">
                    <span>⚠</span>
                    <span>
                      La distancia (km) ingresada abajo se usa tal cual para el cálculo de combustible.
                      En rutas {field.value === "redondo" ? "redondas" : "con múltiples destinos"}, verifica
                      que incluya el recorrido {field.value === "redondo" ? "de ida y vuelta" : "por todas las paradas"};
                      el sistema no lo ajusta automáticamente.
                    </span>
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="nombre" render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre de la ruta</FormLabel>
                <FormControl><Input placeholder="ej. CDMX–Guadalajara Express" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="origen" render={({ field }) => (
                <FormItem>
                  <FormLabel>Origen</FormLabel>
                  <FormControl><Input placeholder="Ciudad origen" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="destino" render={({ field }) => (
                <FormItem>
                  <FormLabel>Destino</FormLabel>
                  <FormControl><Input placeholder="Ciudad destino" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="distanciaKm" render={({ field }) => (
              <FormItem>
                <FormLabel>Distancia (km)</FormLabel>
                <FormControl><Input type="number" min={0} placeholder="Opcional" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {isEditing ? "Guardar cambios" : "Crear ruta"}
              </Button>
            </DialogFooter>
          </form>
        </Form>

        {activeRouteId && (
          <>
            {tipo === "multidestino" && (
              <div className="border-t border-border pt-4 mt-2">
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-primary" />
                  Paradas intermedias
                </p>
                <div className="space-y-1.5 mb-3">
                  {[...localWaypoints].sort((a, b) => a.orden - b.orden).map((wp, i, arr) => (
                    <div key={wp.id} className="flex items-center gap-1 text-sm bg-muted/40 rounded px-2.5 py-1.5">
                      <span className="text-muted-foreground text-xs w-5 shrink-0">{wp.orden}.</span>
                      <span className="flex-1">{wp.ubicacion}</span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          disabled={i === 0 || updateWaypointMutation.isPending}
                          onClick={() => handleMoveWaypoint(i, "up")}
                          title="Subir"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          disabled={i === arr.length - 1 || updateWaypointMutation.isPending}
                          onClick={() => handleMoveWaypoint(i, "down")}
                          title="Bajar"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          onClick={() => handleDeleteWaypoint(activeRouteId, wp.id)}
                        >
                          <X className="w-3 h-3 text-destructive/70" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {localWaypoints.length === 0 && (
                    <p className="text-xs text-muted-foreground pl-1">Sin paradas aún.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ciudad o dirección intermedia"
                    value={waypointInput}
                    onChange={(e) => setWaypointInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddWaypoint(); } }}
                    className="flex-1 h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={handleAddWaypoint} disabled={addWaypointMutation.isPending}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Agregar
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-4 mt-2">
              <p className="text-sm font-medium mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                Casetas de peaje
                {localTolls.length > 0 && (
                  <span className="text-xs text-muted-foreground">({localTolls.length})</span>
                )}
              </p>
              <div className="space-y-1.5 mb-3">
                {localTolls.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm bg-muted/40 rounded px-2.5 py-1.5">
                    <span className="text-muted-foreground text-xs w-5">{t.orden}.</span>
                    <span className="flex-1">{t.nombre}</span>
                    <span className="text-xs text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={t.tarifa}
                      key={`${t.id}-${t.tarifa}`}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (val !== t.tarifa) handleUpdateTollTarifa(activeRouteId, t.id, val);
                      }}
                      className="w-20 h-7 text-xs"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => handleDeleteToll(activeRouteId, t.id)}
                    >
                      <X className="w-3 h-3 text-destructive/70" />
                    </Button>
                  </div>
                ))}
                {localTolls.length === 0 && (
                  <p className="text-xs text-muted-foreground pl-1">Sin casetas registradas.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Nombre de la caseta"
                  value={tollInput}
                  onChange={(e) => setTollInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddToll(); } }}
                  className="flex-1 h-8 text-sm"
                />
                <Input
                  placeholder="Tarifa"
                  type="number"
                  min={0}
                  step="0.01"
                  value={tollTarifaInput}
                  onChange={(e) => setTollTarifaInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddToll(); } }}
                  className="w-24 h-8 text-sm"
                />
                <Button size="sm" variant="outline" onClick={handleAddToll} disabled={addTollMutation.isPending}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar
                </Button>
              </div>
            </div>
          </>
        )}

        {!activeRouteId && (
          <p className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
            Crea la ruta para luego agregar casetas y paradas.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Rutas() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<RouteItem | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [filterTipo, setFilterTipo] = useState<string>("all");

  const { data: routes, isLoading } = useListRoutes({
    query: { queryKey: getListRoutesQueryKey(), refetchInterval: 30_000 },
  });

  const updateMutation = useUpdateRoute();
  const deleteMutation = useDeleteRoute();

  const invalidate = () => {
    queryClient.removeQueries({ queryKey: getListRoutesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
  };

  const handleToggleFavorite = (route: RouteItem) => {
    updateMutation.mutate(
      { id: route.id, data: { favorita: !route.favorita } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: route.favorita ? "Quitada de favoritas" : "Agregada a favoritas" });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          setDeleteId(null);
          toast({ title: "Ruta eliminada" });
        },
        onError: (err: unknown) => {
          const res = (err as { response?: { data?: { error?: string; dispatchCount?: number } } })?.response?.data;
          if (res?.error === "route_has_dispatches") {
            const n = res.dispatchCount ?? 0;
            toast({
              title: "No se puede eliminar la ruta",
              description: `Esta ruta está vinculada a ${n} despacho${n === 1 ? "" : "s"}. Desvincula los despachos antes de eliminarla.`,
              variant: "destructive",
            });
          } else {
            toast({ title: "Error al eliminar la ruta", variant: "destructive" });
          }
          setDeleteId(null);
        },
      }
    );
  };

  const sorted = [...(routes ?? [])].sort((a, b) => {
    if (a.favorita && !b.favorita) return -1;
    if (!a.favorita && b.favorita) return 1;
    return 0;
  });

  const filtered = filterTipo === "all"
    ? sorted
    : sorted.filter((r) => r.tipo === filterTipo);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Rutas</h1>
          <p className="text-muted-foreground">Gestión de rutas con casetas y cálculo de peajes.</p>
        </div>
        <Button onClick={() => { setEditRoute(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Nueva ruta
        </Button>
      </div>

      <div className="flex gap-2">
        {(["all", "sencillo", "redondo", "multidestino"] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={filterTipo === t ? "default" : "outline"}
            onClick={() => setFilterTipo(t)}
            className="text-xs"
          >
            {t === "all" ? "Todas" : TIPO_LABEL[t]}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <MapPin className="w-8 h-8 opacity-30" />
          <p className="text-sm">
            {routes?.length === 0 ? "No hay rutas registradas." : "Sin rutas para este filtro."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((route) => (
            <RouteCard
              key={route.id}
              route={route as RouteItem}
              onEdit={(r) => { setEditRoute(r); setDialogOpen(true); }}
              onDelete={(id) => setDeleteId(id)}
              onToggleFavorite={handleToggleFavorite}
            />
          ))}
        </div>
      )}

      <RouteDialog
        open={dialogOpen}
        route={editRoute}
        onClose={() => { setDialogOpen(false); setEditRoute(null); }}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar ruta?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Esta acción no se puede deshacer. Se eliminará la ruta y todas sus casetas y paradas.</p>
                {(() => {
                  const route = routes?.find((r) => r.id === deleteId) as RouteItem | undefined;
                  const n = route?.linkedDispatchCount ?? 0;
                  if (n === 0) return null;
                  return (
                    <p className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive font-medium">
                      ⚠️ Esta ruta está vinculada a {n} despacho{n === 1 ? "" : "s"} activo{n === 1 ? "" : "s"}. No podrá eliminarse mientras tenga despachos asociados.
                    </p>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteId !== null) handleDelete(deleteId); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
