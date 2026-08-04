import { useLocation, useNavigate } from "@tanstack/react-router";
import { TicketIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchJiraIntegrationStatus, JIRA_CONFIGURATION_CHANGED_EVENT } from "../jira";
import { SidebarMenuButton, useSidebar } from "./ui/sidebar";

export function JiraSidebarButton() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetchJiraIntegrationStatus()
        .then((status) => status.configured)
        .catch(() => false)
        .then((nextConfigured) => {
          if (!cancelled) setConfigured(nextConfigured);
        });
    };
    refresh();
    window.addEventListener(JIRA_CONFIGURATION_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(JIRA_CONFIGURATION_CHANGED_EVENT, refresh);
    };
  }, []);

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
