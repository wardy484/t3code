import { useLocation, useNavigate } from "@tanstack/react-router";
import { TicketIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchKanbanCatalog, KANBAN_CATALOG_CHANGED_EVENT } from "../kanban";
import { useActiveEnvironmentId } from "../state/entities";
import { SidebarMenuButton, useSidebar } from "./ui/sidebar";

export function JiraSidebarButton() {
  const environmentId = useActiveEnvironmentId();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!environmentId) {
        setConfigured(false);
        return;
      }
      void fetchKanbanCatalog(environmentId)
        .then((catalog) => catalog.boards.length > 0)
        .catch(() => false)
        .then((nextConfigured) => {
          if (!cancelled) setConfigured(nextConfigured);
        });
    };
    refresh();
    window.addEventListener(KANBAN_CATALOG_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(KANBAN_CATALOG_CHANGED_EVENT, refresh);
    };
  }, [environmentId]);

  if (!configured) {
    return null;
  }

  return (
    <SidebarMenuButton
      type="button"
      isActive={pathname === "/kanban"}
      onClick={() => {
        if (isMobile) {
          setOpenMobile(false);
        }
        void navigate({ to: "/kanban" });
      }}
    >
      <TicketIcon />
      <span>Tickets</span>
    </SidebarMenuButton>
  );
}
