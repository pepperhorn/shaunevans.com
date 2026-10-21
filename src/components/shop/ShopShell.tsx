"use client";

import { PanelLeft } from "lucide-react";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import ShopSidebar from "@/components/shop/ShopSidebar";
import type { Series } from "@/data/series";

// Mobile-only opener for the off-canvas shop sidebar (desktop has the
// persistent icon strip with its own trigger).
function MobileSidebarTrigger() {
  const { toggleSidebar, openMobile } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-expanded={openMobile}
      className="shop-sidebar-mobile-trigger inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 font-overpass-mono text-sm text-gray-700 hover:bg-muted dark:text-gray-300"
    >
      <PanelLeft className="h-4 w-4" />
      Browse shop
    </button>
  );
}

export default function ShopShell({
  children,
  series = [],
}: {
  children: React.ReactNode;
  series?: Series[];
}) {
  return (
    // Desktop (>=768px, matching useIsMobile; the site's md: is 1200px):
    // collapsed icon strip pinned left; expand via the trigger in the sidebar
    // footer. The negative margins cancel the body's
    // p-8 / md:pl-16 so the in-flow spacer lines up with the fixed panel at x=0.
    // Mobile: sidebar is an off-canvas Sheet opened by MobileSidebarTrigger.
    <SidebarProvider
      defaultOpen={false}
      className="shop-shell min-h-0 min-[768px]:-ml-8 min-[768px]:w-[calc(100%+2rem)] md:-ml-16 md:w-[calc(100%+4rem)]"
    >
      <ShopSidebar series={series} />
      <SidebarInset className="shop-shell-content min-w-0 bg-transparent">
        <div className="shop-shell-toolbar px-4 pt-4 min-[768px]:hidden">
          <MobileSidebarTrigger />
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
