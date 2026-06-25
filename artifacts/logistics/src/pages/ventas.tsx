import React, { useState } from "react";
import { 
  useListSales, getListSalesQueryKey,
  useCreateSale, useUpdateSale, useDeleteSale
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
import { Badge } from "@/components/ui/badge";

const saleSchema = z.object({
  cliente: z.string().min(1, "Required"),
  destino: z.string().min(1, "Required"),
  pesoTotal: z.coerce.number().min(0),
  volumenTotal: z.coerce.number().min(0),
  estado: z.string().default("pendiente"),
  notas: z.string().optional()
});

export default function Ventas() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<any>(null);

  const { data: sales, isLoading } = useListSales({
    query: { queryKey: getListSalesQueryKey() }
  });

  const createMutation = useCreateSale();
  const updateMutation = useUpdateSale();
  const deleteMutation = useDeleteSale();

  const form = useForm<z.infer<typeof saleSchema>>({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      cliente: "",
      destino: "",
      pesoTotal: 0,
      volumenTotal: 0,
      estado: "pendiente",
      notas: ""
    }
  });

  const onSubmit = (values: z.infer<typeof saleSchema>) => {
    if (editingSale) {
      updateMutation.mutate({ id: editingSale.id, data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Sale order updated successfully" });
        }
      });
    } else {
      createMutation.mutate({ data: values }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Sale order created successfully" });
        }
      });
    }
  };

  const handleEdit = (sale: any) => {
    setEditingSale(sale);
    form.reset({
      cliente: sale.cliente,
      destino: sale.destino,
      pesoTotal: sale.pesoTotal,
      volumenTotal: sale.volumenTotal,
      estado: sale.estado,
      notas: sale.notas || ""
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this sale order?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
          toast({ title: "Sale order deleted" });
        }
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pendiente': return <Badge variant="outline" className="text-orange-500 border-orange-500/50">Pendiente</Badge>;
      case 'despachado': return <Badge variant="outline" className="text-blue-500 border-blue-500/50">Despachado</Badge>;
      case 'entregado': return <Badge variant="outline" className="text-green-500 border-green-500/50">Entregado</Badge>;
      case 'cancelado': return <Badge variant="outline" className="text-red-500 border-red-500/50">Cancelado</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Sales Orders</h1>
          <p className="text-muted-foreground">Manage incoming delivery requests.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setEditingSale(null);
            form.reset();
          }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" /> New Order
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSale ? "Edit Order" : "New Order"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="cliente"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="destino"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destination</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="pesoTotal"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Total Weight (kg)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="volumenTotal"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Total Volume (m³)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {editingSale && (
                  <FormField
                    control={form.control}
                    name="estado"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="pendiente">Pendiente</SelectItem>
                            <SelectItem value="despachado">Despachado</SelectItem>
                            <SelectItem value="entregado">Entregado</SelectItem>
                            <SelectItem value="cancelado">Cancelado</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="notas"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end pt-4">
                  <Button type="submit">{editingSale ? "Update" : "Create"}</Button>
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
                <TableHead>Order ID</TableHead>
                <TableHead>Client & Dest</TableHead>
                <TableHead>Load Specs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : sales?.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="font-medium">#{sale.id}</TableCell>
                  <TableCell>
                    <div className="font-medium">{sale.cliente}</div>
                    <div className="text-sm text-muted-foreground">{sale.destino}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{sale.pesoTotal} kg</div>
                    <div className="text-sm text-muted-foreground">{sale.volumenTotal} m³</div>
                  </TableCell>
                  <TableCell>{getStatusBadge(sale.estado)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(sale)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(sale.id)}>
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
