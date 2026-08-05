import { Card, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Plug, RefreshCw, AlertCircle, Truck } from "lucide-react";

/* Static mockup of the Odoo card in Configuración with the new
 * "Albaranes" section — data mirrors the real sync state. */
export default function OdooCardAlbaranes() {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <Card data-testid="card-odoo-sync">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-md bg-primary/15">
                <Plug className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">Integración Odoo</p>
                  <Badge variant="outline" className="text-green-500 border-green-500/50">
                    Configurada
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Última sincronización: 05 ago, 03:57 p. m. · 0 importadas, 754 ya existentes
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Plug className="w-3.5 h-3.5" />
                Probar conexión
              </Button>
              <Button size="sm" className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                Sincronizar ahora
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 justify-between rounded-md border px-3 py-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <Truck className="w-4 h-4 shrink-0 text-muted-foreground" />
              <p className="font-semibold text-xs">Albaranes</p>
              <Badge variant="outline" className="text-green-500 border-green-500/50 text-[10px]">
                OK
              </Badge>
              <p className="text-xs text-muted-foreground truncate">
                Última sincronización: 05 ago, 03:57 p. m. · 1 creado, 0 actualizados
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
              <RefreshCw className="w-3.5 h-3.5" />
              Sincronizar albaranes
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex items-start justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                <span className="text-amber-700 dark:text-amber-400">
                  El albarán LEC/OUT/00024 fue cancelado en Odoo, pero la venta S00052 (LEITON
                  G.P., C.A.) tiene el despacho #7 activo (estado 'pre-despacho') — revisar
                  manualmente.
                </span>
              </div>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] shrink-0">
                Marcar resuelta
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
