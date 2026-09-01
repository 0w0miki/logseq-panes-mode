import { APP_SETTINGS_CONFIG } from '../../core/constants';
import { getPaneIdFromPane, getScrollablePanesContainer } from '../../core/domUtils';
import {
  PaneDimensions,
  readPanesDimensionsFromStorage,
  readPaneCollapseOrientationsFromStorage,
  readPaneFitContentHeightFromStorage,
  writePaneCollapseOrientationToStorage,
  writePaneFitContentHeightToStorage,
} from '../../core/storage';
import { getCurrentSidebarPanes } from './paneCache';
import { setActivePaneByIndex } from './paneNavigation';
import { globalState } from '../../core/pluginGlobalState';
import { updateTabs } from '../tabs/tabs';
import { toggleMultiColumnForPane } from './paneMultiColumn';
import type { CollapseOrientation, PaneElement, FitContentToggleOptions, ToggleType } from './types';

const getVirtuosoScrollElement = (): HTMLElement | null => {
  if (!APP_SETTINGS_CONFIG.isDBVersion) return null;

  if (globalState.virtuosoScrollElement?.isConnected) {
    return globalState.virtuosoScrollElement;
  }

  const list = getScrollablePanesContainer();
  globalState.virtuosoScrollElement = list;

  return list;
};

export const notifyVirtuosoScroll = (): void => {
  const list = getVirtuosoScrollElement();
  if (!list) return;

  list.dispatchEvent(new Event('scroll'));
};

const isFitContentEnabled = (pane: HTMLElement): boolean =>
  (pane as PaneElement)._fitContentActive === true;

const hasStoredPaneHeight = (storedDimensions: PaneDimensions | undefined): boolean =>
  Number.isFinite(storedDimensions?.height) && (storedDimensions?.height ?? 0) > 0;

const shouldUseFitContentHeight = (
  paneId: string,
  storedDimensions: PaneDimensions | undefined,
  storedFitContentHeight: Record<string, boolean>
): boolean => storedFitContentHeight?.[paneId] === true || !hasStoredPaneHeight(storedDimensions);

const shouldEnableFitContentForNewPane = (pane: HTMLElement): boolean => {
  if (isFitContentEnabled(pane)) return false;

  const paneId = getPaneIdFromPane(pane);
  if (!paneId) return true;

  const storedFitContentHeight = readPaneFitContentHeightFromStorage();
  if (typeof storedFitContentHeight?.[paneId] === 'boolean') {
    return storedFitContentHeight[paneId];
  }

  const storedDimensions = readPanesDimensionsFromStorage();

  return !hasStoredPaneHeight(storedDimensions?.[paneId]);
};

const syncFitContentToggleState = (pane: HTMLElement): void => {
  const button = pane.querySelector('.panesMode-fit-content-toggle') as HTMLButtonElement | null;
  if (!button) return;
  const enabled = isFitContentEnabled(pane);
  button.dataset.enabled = enabled ? 'true' : 'false';
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
};

export const enableFitContentForPane = (pane: Element): void => {
  const paneElement = pane as PaneElement;
  if (paneElement.classList.contains('collapsed')) return;

  const pageId = getPaneIdFromPane(paneElement);
  paneElement._fitContentActive = true;
  if (pageId) {
    writePaneFitContentHeightToStorage(pageId, true);
  }
  paneElement.style.height = 'auto';
  paneElement._fitContentBaselineHeightPx = paneElement.offsetHeight;
  syncFitContentToggleState(paneElement);
};

export const disableFitContentForPane = (
  pane: Element,
  options?: FitContentToggleOptions
): void => {
  const paneElement = pane as PaneElement;
  if (!paneElement) return;
  paneElement._fitContentActive = false;
  paneElement._fitContentBaselineHeightPx = undefined;

  const pageId = getPaneIdFromPane(paneElement);
  if (pageId) {
    writePaneFitContentHeightToStorage(pageId, false);
  }
  if (options?.restoreStoredDimensions) {
    applyPaneDimensions(paneElement);
  }
  syncFitContentToggleState(paneElement);
};

export const enableFitContentForNewPane = (pane: Element): void => {
  const paneElement = pane as HTMLElement;
  if (!paneElement) return;
  if (!shouldEnableFitContentForNewPane(paneElement)) return;

  enableFitContentForPane(paneElement);
};

export function createScrollHandler(_pane: Element): (e: Event) => void {
  return () => {
    notifyVirtuosoScroll();
  };
}

export function addScrollListenerToPane(pane: Element): void {
  if (!pane || (pane as any)._hasScrollListener) return;
  const handler = createScrollHandler(pane);
  pane.addEventListener('scroll', handler, { passive: true });
  (pane as any)._scrollHandler = handler;
  (pane as any)._hasScrollListener = true;
}

export function removeScrollListenerFromPane(pane: Element): void {
  if (!pane || !(pane as any)._hasScrollListener) return;
  if ((pane as any)._scrollHandler) {
    pane.removeEventListener('scroll', (pane as any)._scrollHandler);
    delete (pane as any)._scrollHandler;
  }
  (pane as any)._hasScrollListener = false;
}

export function addScrollListenersToAllPanes(): void {
  const panes = getCurrentSidebarPanes();
  panes.forEach(pane => addScrollListenerToPane(pane));
}

export const applyInitialPaneSizes = (idToPaneMap: Map<string, Element>): void => {
  const storedPaneDimensions = readPanesDimensionsFromStorage();
  const storedFitContentHeight = readPaneFitContentHeightFromStorage();
  idToPaneMap.forEach((pane, paneId) => {
    if (pane.classList.contains('collapsed')) return;

    const storedDimensions = storedPaneDimensions?.[paneId];
    const shouldFitContent = shouldUseFitContentHeight(
      paneId, storedDimensions, storedFitContentHeight
    );

    const paneElement = pane as PaneElement;
    if (shouldFitContent) {
      paneElement._fitContentActive = true;
      paneElement.style.height = 'auto';
    } else {
      paneElement._fitContentActive = false;
      paneElement._fitContentBaselineHeightPx = undefined;
    }

    if (storedDimensions) {
      paneElement.style.width = `${storedDimensions.width}px`;
      if (!shouldFitContent) {
        paneElement.style.height = `${storedDimensions.height}px`;
      }
    }
  });
};

const applyPaneWidth = (pane: HTMLElement): void => {
  const pageId = getPaneIdFromPane(pane);
  if (!pageId || pane.classList.contains('collapsed')) return;

  const storedDimensions = readPanesDimensionsFromStorage();
  const storedPaneDimensions = storedDimensions?.[pageId];
  if (!storedPaneDimensions) return;

  pane.style.width = `${storedPaneDimensions.width}px`;
};

export const applyPaneDimensions = (pane: HTMLElement): void => {
  if (pane.classList.contains('collapsed')) return;

  if (isFitContentEnabled(pane)) {
    applyPaneWidth(pane);
    pane.style.height = 'auto';
    return;
  }

  const pageId = getPaneIdFromPane(pane);
  const storedDimensions = readPanesDimensionsFromStorage();
  if (!pageId || !storedDimensions || !storedDimensions[pageId]) return;

  const { width, height } = storedDimensions[pageId];
  pane.style.width = `${width}px`;
  pane.style.height = height > 0 ? `${height}px` : 'auto';
};

export const clearPaneDimensions = (pane: Element): void => {
  const paneElement = pane as HTMLElement;
  paneElement.style.width = '';
  paneElement.style.height = '';
};

const COLLAPSE_ORIENTATION_CLASSES = {
  vertical: 'panesMode-collapse-vertical',
  horizontal: 'panesMode-collapse-horizontal',
} as const;

const getStoredCollapseOrientation = (pane: HTMLElement): CollapseOrientation => {
  const pageId = getPaneIdFromPane(pane);
  const stored = readPaneCollapseOrientationsFromStorage();
  const storedOrientation = pageId
    ? (stored[pageId] as CollapseOrientation | undefined)
    : undefined;
  if (storedOrientation === 'horizontal' || storedOrientation === 'vertical') {
    return storedOrientation;
  }
  if (pageId && !storedOrientation) {
    writePaneCollapseOrientationToStorage(pageId, 'vertical');
  }

  return 'vertical';
};

const setCollapseOrientation = (pane: HTMLElement, orientation: CollapseOrientation): void => {
  const pageId = getPaneIdFromPane(pane);
  if (pageId) {
    writePaneCollapseOrientationToStorage(pageId, orientation);
  }
};

const applyCollapseOrientationClass = (
  pane: HTMLElement,
  nextOrientation?: CollapseOrientation
): CollapseOrientation => {
  const orientation = nextOrientation ?? getStoredCollapseOrientation(pane);
  if (!pane.classList.contains(COLLAPSE_ORIENTATION_CLASSES[orientation])) {
    pane.classList.remove(
      COLLAPSE_ORIENTATION_CLASSES.vertical,
      COLLAPSE_ORIENTATION_CLASSES.horizontal
    );
    pane.classList.add(COLLAPSE_ORIENTATION_CLASSES[orientation]);
  }

  return orientation;
};

const TOGGLE_CONFIG: Record<ToggleType, { className: string; title: string; textContent: string }> = {
  'fit-content': { className: 'panesMode-fit-content-toggle', title: 'Auto resize', textContent: '↕' },
  collapse: { className: 'panesMode-collapse-orientation-toggle', title: 'Toggle collapse orientation', textContent: '⤻' },
  'multi-column': { className: 'panesMode-multicol-toggle', title: 'Toggle multi-column', textContent: '◫' },
};

const getOrCreateToggleButton = (pane: PaneElement, type: ToggleType): HTMLButtonElement | null => {
  const config = TOGGLE_CONFIG[type];

  let container = pane.querySelector('.item-actions') as HTMLElement | null;
  if (!container) {
    container = pane.querySelector('.sidebar-item-header') as HTMLElement | null;
  }
  if (!container) return;

  let toggleButton = pane.querySelector(`.${config.className}`) as HTMLButtonElement | null;

  if (!toggleButton) {
    toggleButton = parent.document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = config.className;
    toggleButton.title = config.title;
    toggleButton.textContent = config.textContent;
    container.insertBefore(toggleButton, container.firstChild);
  }

  return toggleButton;
}

const ensureFitContentToggle = (pane: PaneElement): void => {
  const toggleButton = getOrCreateToggleButton(pane, 'fit-content');
  if (!toggleButton) return;

  syncFitContentToggleState(pane);

  const newClickHandler = () => {
    if (!globalState.isPanesModeModeActive) return;
    if (pane.classList.contains('collapsed')) return;
    if (isFitContentEnabled(pane)) {
      disableFitContentForPane(pane, { restoreStoredDimensions: true });
    } else {
      enableFitContentForPane(pane);
    }
  };

  if ((toggleButton as any)._clickHandler) {
    toggleButton.removeEventListener('click', (toggleButton as any)._clickHandler);
  }
  (toggleButton as any)._clickHandler = newClickHandler;
  toggleButton.addEventListener('click', newClickHandler);
};

const ensureCollapseOrientationToggle = (
  pane: PaneElement,
  orientation: CollapseOrientation
): void => {
  const toggleButton = getOrCreateToggleButton(pane, 'collapse');
  if (!toggleButton) return;

  toggleButton.dataset.orientation = orientation;

  const newClickHandler = () => {
    const currentOrientation = toggleButton!.dataset.orientation as CollapseOrientation;
    const nextOrientation = currentOrientation === 'vertical' ? 'horizontal' : 'vertical';
    setCollapseOrientation(pane, nextOrientation);
    applyCollapseOrientationClass(pane, nextOrientation);
    toggleButton!.dataset.orientation = nextOrientation;
  };

  if ((toggleButton as any)._clickHandler) {
    toggleButton.removeEventListener('click', (toggleButton as any)._clickHandler);
  }
  (toggleButton as any)._clickHandler = newClickHandler;
  toggleButton.addEventListener('click', newClickHandler);
};

const ensureMultiColumnToggle = (pane: PaneElement): void => {
  const toggleButton = getOrCreateToggleButton(pane, 'multi-column');
  if (!toggleButton) return;


  const newClickHandler = () => {
    if (!globalState.isPanesModeModeActive) return;
    toggleMultiColumnForPane(pane);
  };

  if ((toggleButton as any)._clickHandler) {
    toggleButton.removeEventListener('click', (toggleButton as any)._clickHandler);
  }
  (toggleButton as any)._clickHandler = newClickHandler;
  toggleButton.addEventListener('click', newClickHandler);
};

export const observePaneCollapseState = (pane: Element): void => {
  if (!pane) return;
  const paneElement = pane as PaneElement;
  if (paneElement._collapseObserver) return;

  const initialOrientation = applyCollapseOrientationClass(paneElement);
  const initiallyCollapsed = paneElement.classList.contains('collapsed');
  ensureFitContentToggle(paneElement);
  ensureCollapseOrientationToggle(paneElement, initialOrientation);
  ensureMultiColumnToggle(paneElement);
  paneElement._prevCollapsed = initiallyCollapsed;

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const isCollapsed = paneElement.classList.contains('collapsed');
        const wasCollapsed = paneElement._prevCollapsed ?? isCollapsed;
        if (isCollapsed === wasCollapsed) return;

        if (isCollapsed) {
          applyCollapseOrientationClass(paneElement);
          clearPaneDimensions(paneElement);
        } else {
          applyPaneDimensions(paneElement);
        }

        updateTabs(globalState.cachedPanes);
        const paneIndex = globalState.cachedPanes.indexOf(paneElement);
        if (paneIndex !== -1) {
          setActivePaneByIndex(paneIndex, globalState.cachedPanes);
        }
        paneElement._prevCollapsed = isCollapsed;
      }
    }
  });

  observer.observe(paneElement, { attributes: true, attributeFilter: ['class'] });
  paneElement._collapseObserver = observer;
};

export const disconnectPaneCollapseObserver = (pane: Element): void => {
  const paneElement = pane as PaneElement;
  paneElement._collapseObserver?.disconnect();
  delete paneElement._collapseObserver;
};

export const resetPaneCollapse = (pane: PaneElement): void => {
  pane.classList.remove(
    COLLAPSE_ORIENTATION_CLASSES.vertical,
    COLLAPSE_ORIENTATION_CLASSES.horizontal
  );
  clearPaneDimensions(pane);
  disconnectPaneCollapseObserver(pane);
};

export const cleanupPaneToggles = (pane: PaneElement): void => {
  Object.values(TOGGLE_CONFIG).forEach(({ className }) => {
    pane.querySelectorAll(`.${className}`).forEach(toggle => toggle.remove());
  });
};
