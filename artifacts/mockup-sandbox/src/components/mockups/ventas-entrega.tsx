import React, { useState } from "react";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../ui/table";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "../ui/tooltip";
import { AlertTriangle } from "lucide-react";

/* Mock preview of the new Ventas list (data mirrors real DB rows) */

const ENTREGA_BADGE: Record<string, React.ReactElement> = {
  sin_albaran: <Badge variant="outline" className="text-muted-foreground border-muted-foreground/40">Sin albarán</Badge>,
  pendiente:   <Badge variant="outline" className="text-orange-500 border-orange-500/50">Pendiente</Badge>,
  parcial:     <Badge variant="outline" className="text-amber-500 border-amber-500/50">Parcial</Badge>,
  entregado:   <Badge variant="outline" className="text-green-500 border-green-500/50">Entregado</Badge>,
  cancelado:   <Badge variant="outline" className="text-red-500 border-red-500/50">Cancelado</Badge>,
};

const ESTADO_BADGE: Record<string, React.ReactElement> = {
  pendiente:  <Badge variant="outline" className="text-orange-500 border-orange-500/50">Pendiente</Badge>,
  despachado: <Badge variant="outline" className="text-blue-500 border-blue-500/50">Despachado</Badge>,
};

const SALES = [
  { id: 736, ref: "S01344", cliente: "Corporación Digitel", destino: "Maturín", estado: "pendiente", estadoEntrega: "entregado", almacen: "LEC", multi: true },
  { id: 696, ref: "S01285", cliente: "Datalink", destino: "Caracas", estado: "pendiente", estadoEntrega: "parcial", almacen: "CCS", multi: false },
  { id: 11,  ref: null,      cliente: "TELECOM 3, C.A", destino: "Valencia", estado: "despachado", estadoEntrega: "sin_albaran", almacen: null, multi: false },
  { id: 333, ref: "S00636", cliente: "NetUno", destino: "Lechería", estado: "pendiente", estadoEntrega: "pendiente", almacen: "LEC", multi: false },
];

const DESPACHO_FILTERS = [
  { key: "todas", label: "Todas", count: 754 },
  { key: "pendiente", label: "Pendiente", count: 749 },
  { key: "despachado", label: "Despachado", count: 5 },
  { key: "entregado", label: "Entregado", count: 0 },
  { key: "cancelado", label: "Cancelado", count: 0 },
];
const ENTREGA_FILTERS = [
  { key: "todas", label: "Todas", count: 754 },
  { key: "sin_albaran", label: "Sin albarán", count: 13 },
  { key: "pendiente", label: "Pendiente", count: 13 },
  { key: "parcial", label: "Parcial", count: 12 },
  { key: "entregado", label: "Entregado", count: 712 },
  { key: "cancelado", label: "Cancelado", count: 4 },
  { key: "accion", label: "Requieren acción", count: 38 },
];

function Pills({ label, filters, active, onSelect }: { label: string; filters: { key: string; label: string; count: number }[]; active: string; onSelect: (k: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs font-medium text-muted-foreground w-[64px]">{label}</span>
      {filters.map((f) => {
        const isActive = active === f.key;
        return (
          <button key={f.key} onClick={() => onSelect(f.key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors
              ${f.key === "accion" ? "border-dashed" : ""}
              ${isActive ? "border-primary bg-primary/20 text-primary" : "border-border bg-card text-muted-foreground hover:bg-accent/30"}`}>
            {f.key === "accion" && <AlertTriangle className="w-3.5 h-3.5" />}
            {f.label}
            <span className={`text-[11px] rounded-full px-1.5 py-0.5 font-bold min-w-[20px] text-center ${isActive ? "bg-primary/30" : "bg-muted"}`}>{f.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function VentasEntregaPreview() {
  const [despacho, setDespacho] = useState("todas");
  const [entrega, setEntrega] = useState("todas");
  return (
    <TooltipProvider>
      <div className="p-6 space-y-4 bg-background min-h-screen text-foreground">
        <h1 className="text-2xl font-bold">Órdenes de Venta</h1>
        <Pills label="Despacho" filters={DESPACHO_FILTERS} active={despacho} onSelect={setDespacho} />
        <Pills label="Entrega" filters={ENTREGA_FILTERS} active={entrega} onSelect={setEntrega} />
        <p className="text-xs text-muted-foreground">
          711 ventas ya entregadas en Odoo sin despacho registrado en LogiFleet (filas atenuadas).
        </p>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Cliente / Contacto</TableHead>
                  <TableHead>Destino / Material</TableHead>
                  <TableHead>Despacho</TableHead>
                  <TableHead>Entrega</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SALES.map((s) => {
                  const dim = s.estado === "pendiente" && s.estadoEntrega === "entregado";
                  const warn = s.estado === "despachado" && s.estadoEntrega !== "entregado";
                  return (
                    <TableRow key={s.id} className={dim ? "opacity-60" : ""}>
                      <TableCell className="font-medium">#{s.id} {s.ref && <span className="text-xs text-muted-foreground ml-1">{s.ref}</span>}</TableCell>
                      <TableCell>{s.cliente}</TableCell>
                      <TableCell>{s.destino}</TableCell>
                      <TableCell>{ESTADO_BADGE[s.estado]}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {ENTREGA_BADGE[s.estadoEntrega]}
                          {warn && (
                            <Tooltip>
                              <TooltipTrigger asChild><span><AlertTriangle className="w-4 h-4 text-red-500" /></span></TooltipTrigger>
                              <TooltipContent>Despachado en LogiFleet, pero Odoo aún no lo registra como entregado.</TooltipContent>
                            </Tooltip>
                          )}
                          {s.multi && (
                            <Tooltip>
                              <TooltipTrigger asChild><span><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span></TooltipTrigger>
                              <TooltipContent>Esta orden tuvo movimientos en más de un almacén.</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        {s.almacen && <div className="text-[10px] text-muted-foreground mt-0.5">{s.almacen}</div>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
