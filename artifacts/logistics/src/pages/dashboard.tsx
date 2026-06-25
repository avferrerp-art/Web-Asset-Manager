import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  useGetDashboardSummary, 
  getGetDashboardSummaryQueryKey,
  useGetActiveDispatches,
  getGetActiveDispatchesQueryKey
} from "@workspace/api-client-react";
import { Truck, AlertCircle, CheckCircle2, MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey()
    }
  });

  const { data: activeDispatches, isLoading: isLoadingDispatches } = useGetActiveDispatches({
    query: {
      queryKey: getGetActiveDispatchesQueryKey()
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Control Tower</h1>
        <p className="text-muted-foreground">Fleet overview and active operations.</p>
      </div>

      {isLoadingSummary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse bg-muted h-[120px]" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-card border-l-4 border-l-primary shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Fleet</CardTitle>
              <Truck className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.vehiculosDisponibles} / {summary.totalVehiculos}</div>
              <p className="text-xs text-muted-foreground">Available Vehicles</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-l-4 border-l-blue-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">In Transit</CardTitle>
              <MapPin className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.despachosEnRuta}</div>
              <p className="text-xs text-muted-foreground">Active Dispatches</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-l-4 border-l-orange-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Action</CardTitle>
              <AlertCircle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.despachosPendientes}</div>
              <p className="text-xs text-muted-foreground">Awaiting Approval</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-l-4 border-l-green-500 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Completed Today</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.despachosEntregados}</div>
              <p className="text-xs text-muted-foreground">Successful Deliveries</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-12">
        <Card className="md:col-span-12 lg:col-span-8 bg-card border-border">
          <CardHeader>
            <CardTitle>Active Dispatches</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingDispatches ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />)}
              </div>
            ) : activeDispatches && activeDispatches.length > 0 ? (
              <div className="space-y-4">
                {activeDispatches.map(dispatch => (
                  <div key={dispatch.id} className="flex items-center justify-between p-4 border border-border rounded-lg bg-background">
                    <div>
                      <h4 className="font-semibold text-lg">{dispatch.vehiculoModelo}</h4>
                      <p className="text-sm text-muted-foreground">Driver: {dispatch.choferNombre} | Dest: {dispatch.destino}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium">ETA</p>
                        <p className="text-sm text-muted-foreground">{new Date(dispatch.fechaEstimadaLlegada).toLocaleTimeString()}</p>
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2 border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground">
                            <MapPin className="w-4 h-4" />
                            GPS
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[600px] border-border bg-card">
                          <DialogHeader>
                            <DialogTitle>Live Tracking - {dispatch.vehiculoModelo}</DialogTitle>
                          </DialogHeader>
                          <div className="aspect-video w-full bg-muted rounded-md flex items-center justify-center border border-border overflow-hidden">
                            {dispatch.latitud && dispatch.longitud ? (
                              <iframe
                                width="100%"
                                height="100%"
                                style={{ border: 0 }}
                                loading="lazy"
                                allowFullScreen
                                src={`https://www.google.com/maps/embed/v1/place?key=YOUR_API_KEY&q=${dispatch.latitud},${dispatch.longitud}`}
                              ></iframe>
                            ) : (
                              <div className="flex flex-col items-center text-muted-foreground">
                                <MapPin className="w-12 h-12 mb-2 opacity-50" />
                                <p>GPS Signal Not Available</p>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                No active dispatches at the moment.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-12 lg:col-span-4 bg-card border-border">
          <CardHeader>
            <CardTitle>Fleet Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground py-8 text-center">
              Schedule Gantt view loading...
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
