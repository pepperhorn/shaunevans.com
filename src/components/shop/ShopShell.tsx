"use client";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import ShopSidebar from "@/components/shop/ShopSidebar";
import { Separator } from "@/components/ui/separator";
import type { Series } from "@/data/series";

export default function ShopShell({
  children,
  series = [],
}: {
  children: React.ReactNode;
  series?: Series[];
}) {
  return (
    <SidebarProvider>
      <ShopSidebar series={series} />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="font-overpass-mono text-sm text-muted-foreground">
            Shop
          </span>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
