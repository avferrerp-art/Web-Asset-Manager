import React from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Truck, 
  Package, 
  Users, 
  MapPin, 
  Navigation,
  FileText,
  Weight,
  Boxes,
  LogOut,
  Settings
} from "lucide-react";
import { useUser, useClerk } from "@clerk/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
} from "@/components/ui/sidebar";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function UserFooter() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  if (!isLoaded || !user) return null;

  const displayName =
    user.fullName || user.primaryEmailAddress?.emailAddress || "Usuario";

  return (
    <SidebarFooter className="p-3 border-t border-border/50">
      <div className="flex items-center gap-3 px-2">
        {user.imageUrl ? (
          <img
            src={user.imageUrl}
            alt={displayName}
            className="h-8 w-8 rounded-full object-cover"
            data-testid="img-user-avatar"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-semibold text-primary">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" data-testid="text-user-name">
            {displayName}
          </p>
        </div>
        <button
          type="button"
          title="Cerrar sesión"
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </SidebarFooter>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/pre-despacho", label: "Pre-Despacho", icon: FileText },
    { href: "/despachos", label: "Despachos", icon: Package },
    { href: "/ventas", label: "Ventas", icon: FileText },
    { href: "/vehiculos", label: "Vehículos", icon: Truck },
    { href: "/personal", label: "Personal", icon: Users },
    { href: "/rutas", label: "Rutas", icon: MapPin },
    { href: "/carga", label: "Calc. de Carga", icon: Weight },
    { href: "/articulos", label: "Artículos", icon: Boxes },
    { href: "/configuracion", label: "Configuración", icon: Settings },
  ];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background dark">
        <Sidebar className="border-r border-border">
          <SidebarHeader className="p-4 border-b border-border/50">
            <div className="flex items-center gap-2 px-2">
              <Navigation className="h-6 w-6 text-primary" />
              <span className="font-bold text-lg tracking-tight">LogiFleet</span>
            </div>
          </SidebarHeader>
          <SidebarContent className="p-2">
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.href;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.href} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>
          <UserFooter />
        </Sidebar>
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
