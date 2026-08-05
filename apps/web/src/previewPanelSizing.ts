import { requestResizableWidth } from "./hooks/useResizableWidth";

export const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "t3code:preview-panel-width";
export const PREVIEW_PANEL_MIN_WIDTH = 360;
/** Fraction of the viewport allowed, preserving the remaining space for chat. */
export const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
export const PREVIEW_PANEL_DEFAULT_WIDTH = 540;

export function expandPreviewPanelForReview(): void {
  if (typeof window === "undefined") return;
  requestResizableWidth(
    PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    Math.floor(window.innerWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION),
  );
}

export function getPreviewPanelMaxWidth(viewportWidth: number): number {
  return Math.floor(viewportWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
}
