export type ResizeState = {
  isDragging: boolean;
  startX: number;
  startWidth: number;
  resizeRAF: number | null;
  pendingClientX: number | null;
};

export type LeftLayoutElements = {
  leftContainer: HTMLElement | null;
  mainContent: HTMLElement | null;
  leftSidebar: HTMLElement | null;
  rightSidebar: HTMLElement | null;
};
