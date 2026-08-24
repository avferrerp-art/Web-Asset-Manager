import React, { useState } from "react";
import {
  useListPersonnel, getListPersonnelQueryKey,
  useCreatePersonnel, useUpdatePersonnel, useDeletePersonnel,
  useListAlmacenes, getListAlmacenesQueryKey, useReplacePersonnelAlmacenes,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, Search } from "lucide-react";
import { matchesSearch } from "@/lib/search";
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
import { Checkbox } from "@/components/ui/checkbox";

const personnelSchema = z.object({
  nombre: z.string().min(1, "Requerido"),
  rol: z.string().min(1, "Requerido"),
  tarifaViaticos: z.coerce.number().min(0),
  telefono: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  almacenIds: z.array(z.number()),
});

export default function Personal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<any>(null);
  const [search, setSearch] = useState("");

  const { data: personnel, isLoading } = useListPersonnel({
    query: { queryKey: getListPersonnelQueryKey() }
  });
  const { data: almacenes } = useListAlmacenes({
    query: { queryKey: getListAlmacenesQueryKey() },
  });

  const filteredPersonnel = search.trim()
    ? (personnel ?? []).filter(p => matchesSearch(search, [
      p.nombre,
      p.rol,
      p.telefono,
      p.almacenes?.map((almacen) => almacen.nombre).join(", "),
    ]))
    : (personnel ?? []);

  const createMutation = useCreatePersonnel();
  const updateMutation = useUpdatePersonnel();
  const deleteMutation = useDeletePersonnel();
  const replaceAlmacenesMutation = useReplacePersonnelAlmacenes();

  const form = useForm<z.infer<typeof personnelSchema>>({
    resolver: zodResolver(personnelSchema),
    defaultValues: {
      nombre: "",
      rol: "chofer",
      tarifaViaticos: 0,
      telefono: "",
      email: "",
      almacenIds: [],
    }
  });
  const selectedRole = form.watch("rol");
  const selectedAlmacenIds = form.watch("almacenIds");

  const refreshPersonnel = async () => {
    await queryClient.removeQueries({ queryKey: getListPersonnelQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListPersonnelQueryKey() });
  };

  const closeAfterSave = async (message: string) => {
    await refreshPersonnel();
    setIsDialogOpen(false);
    toast({ title: message });
  };

  const onSubmit = (values: z.infer<typeof personnelSchema>) => {
    const { almacenIds, ...personnelValues } = values;
    const saveAssignmentsIfNeeded = (personId: number, successMessage: string) => {
      // Assignments are deliberately preserved when a person moves away from
      // almacenista; authorization cleanup is outside this initial rollout.
      if (values.rol !== "almacenista") {
        void closeAfterSave(successMessage);
        return;
      }
      replaceAlmacenesMutation.mutate(
        { id: personId, data: { almacenIds } },
        {
          onSuccess: () => {
            void closeAfterSave(successMessage);
          },
          onError: () => {
            toast({
              variant: "destructive",
              title: "No se pudieron guardar los almacenes asignados",
            });
          },
        },
      );
    };

    if (editingPersonnel) {
      updateMutation.mutate({ id: editingPersonnel.id, data: personnelValues }, {
        onSuccess: () => {
          saveAssignmentsIfNeeded(editingPersonnel.id, "Personal actualizado correctamente");
        },
        onError: () => {
          toast({ variant: "destructive", title: "No se pudo actualizar el personal" });
        },
      });
    } else {
      createMutation.mutate({ data: personnelValues }, {
        onSuccess: (person) => {
          saveAssignmentsIfNeeded(person.id, "Personal registrado correctamente");
        },
        onError: () => {
          toast({ variant: "destructive", title: "No se pudo registrar el personal" });
        },
      });
    }
  };

  const handleEdit = (person: any) => {
    setEditingPersonnel(person);
    form.reset({
      nombre: person.nombre,
      rol: person.rol,
      tarifaViaticos: person.tarifaViaticos,
      telefono: person.telefono || "",
      email: person.email || "",
      almacenIds: person.almacenes?.map((almacen: { id: number }) => almacen.id) ?? [],
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("¿Deseas eliminar este registro de personal?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          void refreshPersonnel();
          toast({ title: "Personal eliminado" });
        },
        onError: () => {
          toast({ variant: "destructive", title: "No se pudo eliminar el personal" });
        },
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Personal</h1>
          <p className="text-muted-foreground">Gestión de personal y asignaciones de almacén.</p>
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
                          <SelectItem value="almacenista">Almacenista</SelectItem>
                          <SelectItem value="oficina">Oficina</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {selectedRole === "almacenista" && (
                  <FormField control={form.control} name="almacenIds" render={() => (
                    <FormItem>
                      <FormLabel>Almacenes asignados</FormLabel>
                      <div className="rounded-md border p-3 space-y-2">
                        {almacenes?.length ? almacenes.map((almacen) => {
                          const checked = selectedAlmacenIds.includes(almacen.id);
                          return (
                            <label
                              key={almacen.id}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                              <Checkbox
                                data-testid={`checkbox-almacen-${almacen.id}`}
                                checked={checked}
                                onCheckedChange={(nextChecked) => {
                                  form.setValue(
                                    "almacenIds",
                                    nextChecked
                                      ? [...selectedAlmacenIds, almacen.id]
                                      : selectedAlmacenIds.filter((id) => id !== almacen.id),
                                    { shouldDirty: true },
                                  );
                                }}
                              />
                              <span>{almacen.nombre} · {almacen.plaza}</span>
                            </label>
                          );
                        }) : (
                          <p className="text-sm text-muted-foreground">No hay almacenes activos disponibles.</p>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
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
                  <Button data-testid="button-submit-personnel" type="submit" disabled={createMutation.isPending || updateMutation.isPending || replaceAlmacenesMutation.isPending}>
                    {editingPersonnel ? "Actualizar" : "Agregar"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative flex-1 min-w-[220px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, rol o teléfono..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9"
          data-testid="input-search-personnel"
        />
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
                <TableHead>Almacenes</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center">Cargando...</TableCell></TableRow>
              ) : filteredPersonnel.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {search.trim() ? `Sin resultados para "${search.trim()}"` : "Sin personal registrado."}
                </TableCell></TableRow>
              ) : filteredPersonnel.map((person) => (
                <TableRow key={person.id} data-testid={`row-personnel-${person.id}`}>
                  <TableCell className="font-medium">{person.nombre}</TableCell>
                  <TableCell className="capitalize">{person.rol}</TableCell>
                  <TableCell>{person.telefono || "S/N"}</TableCell>
                  <TableCell>{person.email || "—"}</TableCell>
                  <TableCell>${person.tarifaViaticos}/día</TableCell>
                  <TableCell>{person.almacenes?.map((almacen) => almacen.nombre).join(", ") || "—"}</TableCell>
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
