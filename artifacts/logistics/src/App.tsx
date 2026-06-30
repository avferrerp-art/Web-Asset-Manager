import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import PreDespacho from "@/pages/pre-despacho";
import Despachos from "@/pages/despachos";
import Ventas from "@/pages/ventas";
import Vehiculos from "@/pages/vehiculos";
import Personal from "@/pages/personal";
import Rutas from "@/pages/rutas";
import Carga from "@/pages/carga";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/pre-despacho" component={PreDespacho} />
        <Route path="/despachos" component={Despachos} />
        <Route path="/ventas" component={Ventas} />
        <Route path="/vehiculos" component={Vehiculos} />
        <Route path="/personal" component={Personal} />
        <Route path="/rutas" component={Rutas} />
        <Route path="/carga" component={Carga} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
