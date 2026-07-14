import { Link } from "wouter";
import { Navigation, Truck, MapPin, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="dark min-h-[100dvh] bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between px-8 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <Navigation className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg tracking-tight">LogiFleet</span>
        </div>
        <Link href="/sign-in">
          <Button data-testid="button-header-signin">Iniciar sesión</Button>
        </Link>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight max-w-2xl">
          Gestión logística de <span className="text-primary">Netso</span>
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-xl">
          Despachos, rutas, costos y flota en un solo lugar. Acceso exclusivo
          para el personal autorizado.
        </p>
        <Link href="/sign-in">
          <Button size="lg" className="mt-8" data-testid="button-hero-signin">
            Iniciar sesión
          </Button>
        </Link>
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            <span>Control de flota y despachos</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" />
            <span>Rutas con casetas y peajes</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <DollarSign className="h-6 w-6 text-primary" />
            <span>Costos estimados por viaje</span>
          </div>
        </div>
      </main>
    </div>
  );
}
