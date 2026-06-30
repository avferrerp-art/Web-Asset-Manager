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
  Weight
} from "lucide-react";
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
