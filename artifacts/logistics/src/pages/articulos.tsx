import React, { useState } from "react";
import {
  useListProducts, getListProductsQueryKey,
  useGetProductStats, getGetProductStatsQueryKey,
  useUpdateProduct, useSyncOdooProducts,
} from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Boxes, Search, RefreshCw, Check, ArrowLeft, Edit2,
  Scale, AlertTriangle, Loader2, StickyNote,
} from "lucide-react";

export default function Articulos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sinPesoOdoo, setSinPesoOdoo] = useState(false);
  const [editingNotas, setEditingNotas] = useState<{ id: number; notas: string } | null>(null);

  const listParams = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(sinPesoOdoo ? { sinPesoOdoo: true } : {}),
  };
  const { data: products, isLoading } = useListProducts(listParams, {
    query: { queryKey: getListProductsQueryKey(listParams) },
  });
  const { data: stats } = useGetProductStats({
    query: { queryKey: getGetProductStatsQueryKey() },
  });

  const updateProduct = useUpdateProduct();
  const syncProducts = useSyncOdooProducts();

  function bustCache() {
    queryClient.removeQueries({ queryKey: getListProductsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    queryClient.removeQueries({ queryKey: getGetProductStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetProductStatsQueryKey() });
  }

  function handleSaveNotas() {
    if (!editingNotas) return;
    updateProduct.mutate(
      { id: editingNotas.id, data: { notas: editingNotas.notas.trim() || null } },
      {
        onSuccess: () => {
          bustCache();
          setEditingNotas(null);
          toast({ title: "Notas guardadas" });
        },
        onError: (err) => {
          toast({ title: "Error al guardar", description: String(err), variant: "destructive" });
        },
      },
    );
  }

  function handleSync() {
    syncProducts.mutate(undefined, {
      onSuccess: (result) => {
        bustCache();
        toast({
          title: "Sincronización completada",
          description: `${result.total} artículos procesados (${result.created} nuevos, ${result.updated} actualizados).`,
        });
      },
      onError: (err) => {
        const msg =
          err && typeof err === "object" && "error" in err && err.error
            ? String(err.error)
            : String(err);
        toast({ title: "Error de sincronización", description: msg, variant: "destructive" });
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Artículos</h1>
          <p className="text-muted-foreground">
            Catálogo de consulta sincronizado desde Odoo. El peso y el volumen provienen de Odoo; si faltan, se corrigen allí.
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncProducts.isPending} className="gap-2" data-testid="button-sync-products">
          {syncProducts.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          {syncProducts.isPending ? "Sincronizando..." : "Sincronizar con Odoo"}
        </Button>
      </div>

      {/* Stats + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="bg-card border border-border rounded-full px-4 py-1.5 text-sm flex items-center gap-2" data-testid="text-peso-counter">
          <Scale className="w-3.5 h-3.5 text-green-500" />
          <span className="font-semibold">{stats?.conPesoOdoo ?? 0} de {stats?.total ?? 0}</span>
          <span className="text-muted-foreground">artículos con peso en Odoo</span>
        </div>
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o referencia..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
            data-testid="input-search-products"
          />
        </div>
        <Button
          variant={sinPesoOdoo ? "default" : "outline"}
          size="sm"
          onClick={() => setSinPesoOdoo(v => !v)}
          className="gap-2"
          data-testid="button-filter-sin-peso"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Sin peso en Odoo
          {sinPesoOdoo && stats ? ` (${stats.sinPesoOdoo})` : ""}
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-10">Cargando artículos...</p>
          ) : (products?.length ?? 0) === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Boxes className="w-8 h-8 mx-auto mb-2 opacity-50" />
              {sinPesoOdoo
                ? "Todos los artículos tienen peso registrado en Odoo."
                : "Sin artículos. Pulsa \u201CSincronizar con Odoo\u201D para importar el catálogo."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-left">
                    <th className="px-4 py-2 font-medium">Referencia</th>
                    <th className="px-4 py-2 font-medium">Nombre</th>
                    <th className="px-4 py-2 font-medium">Categoría</th>
                    <th className="px-4 py-2 font-medium text-right">Peso Odoo (kg)</th>
                    <th className="px-4 py-2 font-medium text-right">Vol. Odoo (m³)</th>
                    <th className="px-4 py-2 font-medium">Notas</th>
                    <th className="px-4 py-2 w-[60px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {products?.map((p: Product) => (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/10" data-testid={`row-product-${p.id}`}>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.odooRef ?? "—"}</td>
                      <td className="px-4 py-2.5 font-medium">{p.nombre}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.categoria ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right" data-testid={`text-peso-${p.id}`}>
                        {p.pesoOdoo > 0
                          ? <span className="font-medium">{p.pesoOdoo}</span>
                          : (
                            <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30 gap-1" variant="outline">
                              <AlertTriangle className="w-3 h-3" /> sin dato en Odoo
                            </Badge>
                          )}
                      </td>
                      <td className="px-4 py-2.5 text-right" data-testid={`text-volumen-${p.id}`}>
                        {p.volumenOdoo > 0
                          ? <span className="text-muted-foreground">{p.volumenOdoo}</span>
                          : <span className="text-muted-foreground/60 text-xs">sin dato en Odoo</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {editingNotas?.id === p.id ? (
                          <Input
                            autoFocus
                            value={editingNotas.notas}
                            onChange={(e) => setEditingNotas({ id: p.id, notas: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSaveNotas(); if (e.key === "Escape") setEditingNotas(null); }}
                            className="h-7 text-xs"
                            data-testid={`input-notas-${p.id}`}
                          />
                        ) : p.notas ? (
                          <span className="text-muted-foreground text-xs flex items-center gap-1">
                            <StickyNote className="w-3 h-3 shrink-0" /> {p.notas}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1 justify-end">
                          {editingNotas?.id === p.id ? (
                            <>
                              <Button size="icon" className="h-6 w-6" onClick={handleSaveNotas} disabled={updateProduct.isPending} data-testid={`button-save-notas-${p.id}`}>
                                <Check className="w-3 h-3" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingNotas(null)}>
                                <ArrowLeft className="w-3 h-3" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => setEditingNotas({ id: p.id, notas: p.notas ?? "" })}
                              title="Editar notas"
                              data-testid={`button-edit-notas-${p.id}`}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
