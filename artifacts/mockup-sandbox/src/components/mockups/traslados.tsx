import React from "react";
import { ArrowRight, ArrowRightLeft, Info, Search, TriangleAlert } from "lucide-react";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

const transfers = [
  {
    referencia: "Urbin/INT/00070",
    origen: "Urbina",
    destino: "Lechería",
    fecha: "13 ago 2026",
    estado: "Por planificar",
    lineas: 1,
    peso: null,
    interplaza: true,
    mismoAlmacen: false,
  },
  {
    referencia: "Urbin/INT/00045",
    origen: "Lechería",
    destino: "Urbina",
    fecha: "03 jul 2026",
    estado: "Cancelado",
    lineas: 1,
    peso: "96 kg",
    interplaza: true,
    mismoAlmacen: false,
  },
  {
    referencia: "Urbin/INT/00014",
    origen: "Urbina",
    destino: "Urbina",
    fecha: "08 abr 2026",
    estado: "Por planificar",
    lineas: 0,
    peso: null,
    interplaza: false,
    mismoAlmacen: true,
  },
  {
    referencia: "Urbin/INT/00003",
    origen: "Caracas",
    destino: "Lechería",
    fecha: "10 mar 2026",
    estado: "Cancelado",
    lineas: 1,
    peso: null,
    interplaza: true,
    mismoAlmacen: false,
  },
];

function Status({ value }: { value: string }) {
  return (
    <Badge
      variant="outline"
      className={
        value === "Cancelado"
          ? "border-red-500/50 text-red-500"
          : "border-orange-500/50 text-orange-500"
      }
    >
      {value}
    </Badge>
  );
}

export default function TrasladosPreview() {
  return (
    <TooltipProvider>
      <div className="dark min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto max-w-[1500px] space-y-5">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              <ArrowRightLeft className="h-8 w-8 text-primary" />
              Traslados
            </h1>
            <p className="mt-1 text-muted-foreground">
              144 movimientos internos sincronizados desde Odoo
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value="lecheria" readOnly />
            </div>
            {["Origen: Todos", "Destino: Lechería", "Estado: Todos"].map((label) => (
              <div
                key={label}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {label}
              </div>
            ))}
            <Badge variant="secondary">81 interplaza</Badge>
            <Badge variant="secondary">63 intraplaza</Badge>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(430px,0.75fr)]">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Origen → Destino</TableHead>
                      <TableHead>Fecha programada</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Artículos</TableHead>
                      <TableHead className="text-right">Peso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transfers.map((transfer) => (
                      <TableRow
                        key={transfer.referencia}
                        className={
                          transfer.mismoAlmacen
                            ? "bg-muted/20 opacity-55"
                            : transfer.referencia === "Urbin/INT/00003"
                              ? "bg-primary/5"
                              : ""
                        }
                      >
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            {transfer.referencia}
                            {transfer.mismoAlmacen && (
                              <Tooltip defaultOpen>
                                <TooltipTrigger>
                                  <Info className="h-3.5 w-3.5" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  Reubicación dentro del mismo almacén; no requiere transporte.
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{transfer.origen}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{transfer.destino}</span>
                            {transfer.interplaza && (
                              <Badge
                                variant="outline"
                                className="border-purple-500/50 bg-purple-500/10 text-[10px] text-purple-400"
                              >
                                Interplaza
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{transfer.fecha}</TableCell>
                        <TableCell>
                          <Status value={transfer.estado} />
                        </TableCell>
                        <TableCell className="text-right">{transfer.lineas}</TableCell>
                        <TableCell className="text-right">
                          {transfer.peso ?? (
                            <span className="text-xs italic text-muted-foreground">
                              sin dato en Odoo
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-primary/20">
              <div className="space-y-4 border-b border-border px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Traslado seleccionado</p>
                    <h2 className="text-xl font-semibold">Urbin/INT/00003</h2>
                  </div>
                  <Status value="Cancelado" />
                  <Badge
                    variant="outline"
                    className="border-purple-500/50 bg-purple-500/10 text-purple-400"
                  >
                    Interplaza
                  </Badge>
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Almacén de origen
                    </p>
                    <p className="font-medium">Caracas</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Almacén de destino
                    </p>
                    <p className="font-medium">Lechería</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Fecha programada</span>
                  <span>10 mar 2026</span>
                  <span className="text-muted-foreground">Fecha efectiva</span>
                  <span>—</span>
                  <span className="text-muted-foreground">Peso</span>
                  <span className="italic text-muted-foreground">sin dato en Odoo</span>
                  <span className="text-muted-foreground">Volumen</span>
                  <span className="italic text-muted-foreground">sin dato en Odoo</span>
                </div>
              </div>

              <CardContent className="space-y-3 p-5">
                <h3 className="font-semibold">Líneas del traslado</h3>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="mb-3 flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-400" />
                    <div>
                      <p className="text-sm font-medium">
                        ONT SUMEC NAVIGATOR T21 CON CATV
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">NTS050036</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-right text-xs">
                    <div>
                      <p className="text-muted-foreground">Demanda</p>
                      <p className="font-semibold">500</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Recibido</p>
                      <p className="font-semibold text-amber-400">0</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Diferencia</p>
                      <p className="font-semibold text-amber-400">500</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Unidad</p>
                      <p className="font-semibold">Units</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  La diferencia se resalta de forma sutil para revisar la recepción.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}