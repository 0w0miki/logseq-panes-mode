export type CollapseOrientation = 'vertical' | 'horizontal';

export type PaneElement = HTMLElement & {
  _collapseObserver?: MutationObserver;
  _prevCollapsed?: boolean;
  _isResizeObserved?: boolean;
  _fitContentActive?: boolean;
  _fitContentBaselineHeightPx?: number;
};

export type FitContentToggleOptions = {
  restoreStoredDimensions?: boolean;
};

export type ToggleType = 'collapse' | 'fit-content' | 'multi-column';