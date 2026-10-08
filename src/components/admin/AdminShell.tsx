import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Home, LogOut, MessagesSquare, Table2 } from "lucide-react";
import type { ReactNode } from "react";

import { ObraLogoIcon } from "@/components/ObraLogo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { title: "Home", to: "/admin", icon: Home },
  { title: "Contractor Research", to: "/admin/contractor-research", icon: Table2 },
  { title: "Agent traces", to: "/admin/traces", icon: MessagesSquare },
  { title: "Observability", to: "/admin/observability", icon: Activity },
] as const;

function AdminSidebarNav({ onLogout }: { onLogout: () => Promise<void> }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          to="/"
          onClick={() => setOpenMobile(false)}
          className="flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 hover:opacity-90"
        >
          <ObraLogoIcon size={28} />
          <span className="truncate font-display text-base font-semibold tracking-tight text-gradient-violet group-data-[collapsible=icon]:hidden">
            Obra
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={pathname === item.to} tooltip={item.title}>
                    <Link to={item.to} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Log out"
              onClick={() => {
                setOpenMobile(false);
                void onLogout();
              }}
            >
              <LogOut />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function AdminShell({
  onLogout,
  children,
}: {
  onLogout: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <AdminSidebarNav onLogout={onLogout} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
