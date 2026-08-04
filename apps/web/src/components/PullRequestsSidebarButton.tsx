import { useLocation, useNavigate } from "@tanstack/react-router";
import { GitPullRequestIcon } from "lucide-react";

import { SidebarMenuButton, useSidebar } from "./ui/sidebar";

export function PullRequestsSidebarButton() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenuButton
      type="button"
      isActive={pathname === "/pull-requests"}
      onClick={() => {
        if (isMobile) setOpenMobile(false);
        void navigate({ to: "/pull-requests" });
      }}
    >
      <GitPullRequestIcon />
      <span>Pull requests</span>
    </SidebarMenuButton>
  );
}
