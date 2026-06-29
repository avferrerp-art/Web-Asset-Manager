import React, { useState } from "react";
import {
  useListTolls, getListTollsQueryKey,
  useCreateToll, useUpdateToll, useDeleteToll
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const tollSchema = z.object({
  origen: z.string().min(1, "Requerido"),
  destino: z.string().min(1, "Requerido"),
  cantidadPeajes: z.coerce.number().min(0),
  costoTotal: z.coerce.number().min(0),
  descripcion: z.string().optional()
});

export default function Peajes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingToll, setEditingToll] = useState<any>(null);

  const { data: tolls, isLoading } = useListTolls({
    query: { queryKey: getListTollsQueryKey() }
  });

  const createMutation = useCreateToll();
  const updateMutation = useUpdateToll();
  const deleteMutation = useDeleteToll();

  const form = useForm<z.infer<typeof tollSchema>>({
    resolver: zodResolver(tollSchema),
    defaultValues: { origen: "", destino: "", cantidadPeajes: 0, costoTotal: 0, descripcion: "" }
  });

  const onSubmit = (values: z.infer<typeof tollSchema>) => {
    if (editingToll) {
      updateMutation.mutate({ id: editingToll.id, data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTollsQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Ruta de peaje actualizada correctamente" });
        }
      });
    } else {
      createMutation.mutate({ data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTollsQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Ruta de peaje agregada correctamente" });
        }
      });
    }
  };

  const handleEdit = (toll: any) => {
    setEditingToll(toll);
    form.reset({ origen: toll.origen, destino: toll.destino, cantidadPeajes: toll.cantidadPeajes, costoTotal: toll.costoTotal, descripcion: toll.descripcion || "" });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("¿Deseas eliminar esta ruta de peaje?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTollsQueryKey() });
          toast({ title: "Ruta de peaje eliminada" });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Peajes</h1>
          <p className="text-muted-foreground">Gestión de costos de peaje por ruta.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) { setEditingToll(null); form.reset(); }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-toll" className="gap-2">
              <Plus className="w-4 h-4" /> Agregar Ruta
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingToll ? "Editar Ruta de Peaje" : "Agregar Ruta de Peaje"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="origen" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Origen</FormLabel>
                      <FormControl><Input data-testid="input-origen" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="destino" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destino</FormLabel>
                      <FormControl><Input data-testid="input-destino" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="cantidadPeajes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número de Casetas</FormLabel>
                      <FormControl><Input data-testid="input-cantidad" type="number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="costoTotal" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Costo Total ($)</FormLabel>
                      <FormControl><Input data-testid="input-costo" type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="descripcion" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción (Opcional)</FormLabel>
                    <FormControl><Input data-testid="input-descripcion" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex justify-end pt-4">
                  <Button data-testid="button-submit-toll" type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {editingToll ? "Actualizar" : "Agregar"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ruta</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Casetas</TableHead>
                <TableHead className="text-right">Costo Total</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : tolls?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Sin rutas de peaje registradas.</TableCell></TableRow>
              ) : tolls?.map((toll) => (
                <TableRow key={toll.id} data-testid={`row-toll-${toll.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {toll.origen} <ArrowRight className="w-4 h-4 text-muted-foreground" /> {toll.destino}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{toll.descripcion || "—"}</TableCell>
                  <TableCell className="text-right">{toll.cantidadPeajes}</TableCell>
                  <TableCell className="text-right font-medium">${toll.costoTotal}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button data-testid={`button-edit-toll-${toll.id}`} variant="ghost" size="icon" onClick={() => handleEdit(toll)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button data-testid={`button-delete-toll-${toll.id}`} variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(toll.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
