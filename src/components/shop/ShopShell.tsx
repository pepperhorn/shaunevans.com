"use client";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import ShopSidebar from "@/components/shop/ShopSidebar";
import type { Series } from "@/data/series";

export default function ShopShell({
  children,
  series = [],
}: {
  children: React.ReactNode;
  series?: Series[];
}) {
  return (
    // Start collapsed by default → users see a persistent icon strip on the
    // left, which they can tap to navigate or expand via tapping the trigger
    // inside the sidebar itself.
    <SidebarProvider defaultOpen={false}>
      <ShopSidebar series={series} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
