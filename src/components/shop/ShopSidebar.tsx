"use client";

import {
  Disc3,
  GraduationCap,
  Heart,
  ListOrdered,
  LogIn,
  Music,
  ShoppingBag,
  Store,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const CATEGORIES = [
  { slug: "sheet-music", label: "Sheet Music", icon: Music },
  { slug: "recordings", label: "Recordings", icon: Disc3 },
  { slug: "merch", label: "Merch", icon: ShoppingBag },
  { slug: "courses", label: "Courses", icon: GraduationCap },
];

const ACCOUNT = [
  { href: "#", label: "Sign in", icon: LogIn },
  { href: "#", label: "Orders", icon: ListOrdered },
  { href: "#", label: "Wishlist", icon: Heart },
];

export default function ShopSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Shop">
              <a href="/shop/">
                <Store />
                <span className="font-overpass-mono text-base">Shop</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Categories</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {CATEGORIES.map(({ slug, label, icon: Icon }) => (
                <SidebarMenuItem key={slug}>
                  <SidebarMenuButton asChild tooltip={label}>
                    <a href={`#${slug}`}>
                      <Icon />
                      <span>{label}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ACCOUNT.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton asChild tooltip={label}>
                    <a href={href}>
                      <Icon />
                      <span>{label}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarTrigger className="ml-auto" />
      </SidebarFooter>
    </Sidebar>
  );
}
