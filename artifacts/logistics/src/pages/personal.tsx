import React, { useState } from "react";
import {
  useListPersonnel, getListPersonnelQueryKey,
  useCreatePersonnel, useUpdatePersonnel, useDeletePersonnel
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const personnelSchema = z.object({
  nombre: z.string().min(1, "Requerido"),
  rol: z.string().min(1, "Requerido"),
  tarifaViaticos: z.coerce.number().min(0),
  telefono: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal(""))
});

export default function Personal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<any>(null);

  const { data: personnel, isLoading } = useListPersonnel({
    query: { queryKey: getListPersonnelQueryKey() }
  });

  const createMutation = useCreatePersonnel();
  const updateMutation = useUpdatePersonnel();
  const deleteMutation = useDeletePersonnel();

  const form = useForm<z.infer<typeof personnelSchema>>({
    resolver: zodResolver(personnelSchema),
    defaultValues: { nombre: "", rol: "chofer", tarifaViaticos: 0, telefono: "", email: "" }
  });

  const onSubmit = (values: z.infer<typeof personnelSchema>) => {
    if (editingPersonnel) {
      updateMutation.mutate({ id: editingPersonnel.id, data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPersonnelQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Personal actualizado correctamente" });
        }
      });
    } else {
      createMutation.mutate({ data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPersonnelQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Personal registrado correctamente" });
        }
      });
    }
  };

  const handleEdit = (person: any) => {
    setEditingPersonnel(person);
    form.reset({ nombre: person.nombre, rol: person.rol, tarifaViaticos: person.tarifaViaticos, telefono: person.telefono || "", email: person.email || "" });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("¿Deseas eliminar este registro de personal?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPersonnelQueryKey() });
          toast({ title: "Personal eliminado" });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Personal</h1>
          <p className="text-muted-foreground">Gestión de choferes y ayudantes.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) { setEditingPersonnel(null); form.reset(); }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-personnel" className="gap-2">
              <Plus className="w-4 h-4" /> Agregar Personal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingPersonnel ? "Editar Personal" : "Agregar Personal"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="nombre" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl><Input data-testid="input-nombre" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="rol" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rol</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-rol"><SelectValue placeholder="Seleccionar rol" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="chofer">Chofer</SelectItem>
                        <SelectItem value="ayudante">Ayudante</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="telefono" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono</FormLabel>
                    <FormControl><Input data-testid="input-telefono" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (para la app de chofer)</FormLabel>
                    <FormControl><Input data-testid="input-email" type="email" placeholder="chofer@empresa.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="tarifaViaticos" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tarifa de Viáticos ($/día)</FormLabel>
                    <FormControl><Input data-testid="input-tarifa" type="number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex justify-end pt-4">
                  <Button data-testid="button-submit-personnel" type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {editingPersonnel ? "Actualizar" : "Agregar"}
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
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Tarifa Diaria</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : personnel?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Sin personal registrado.</TableCell></TableRow>
              ) : personnel?.map((person) => (
                <TableRow key={person.id} data-testid={`row-personnel-${person.id}`}>
                  <TableCell className="font-medium">{person.nombre}</TableCell>
                  <TableCell className="capitalize">{person.rol}</TableCell>
                  <TableCell>{person.telefono || "S/N"}</TableCell>
                  <TableCell>{person.email || "—"}</TableCell>
                  <TableCell>${person.tarifaViaticos}/día</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button data-testid={`button-edit-personnel-${person.id}`} variant="ghost" size="icon" onClick={() => handleEdit(person)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button data-testid={`button-delete-personnel-${person.id}`} variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(person.id)}>
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
