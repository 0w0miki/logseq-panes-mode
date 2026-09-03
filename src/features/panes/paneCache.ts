import { LOGSEQ_UI_SELECTORS } from '../../core/constants';
import { arePanesDifferent, getScrollablePanesContainer } from '../../core/domUtils';
import { globalState } from '../../core/pluginGlobalState';

export const getSidebarPanes = (forceRefresh: boolean = false): Element[] => {
  const container = getScrollablePanesContainer();
  if (!container) return [];
  if (forceRefresh || globalState.cachedPanes.length === 0) {
    globalState.cachedPanes = Array.from(
      container.querySelectorAll(`:scope > ${LOGSEQ_UI_SELECTORS.sidebarItem}`)
    );
    syncPaneIndices(globalState.cachedPanes);
  }

  return globalState.cachedPanes;
};

export const getCurrentSidebarPanes = (container?: Element): Element[] => {
  const panesContainer = container || getScrollablePanesContainer();
  if (!panesContainer) return [];

  return Array.from(panesContainer.querySelectorAll(`:scope > ${LOGSEQ_UI_SELECTORS.sidebarItem}`));
};

export const refreshPanesElementsCache = (updatedPanes?: Element[]): void => {
  const isRefreshRequired = arePanesDifferent(globalState.cachedPanes, updatedPanes);
  if (!isRefreshRequired) return;

  const container = getScrollablePanesContainer();
  if (!container) {
    globalState.cachedPanes = [];

    return;
  }

  globalState.cachedPanes = Array.from(
    container.querySelectorAll(`:scope > ${LOGSEQ_UI_SELECTORS.sidebarItem}`)
  );
  syncPaneIndices(globalState.cachedPanes);
};

export const syncPaneIndices = (panes?: Element[]): void => {
  const panesToSync = panes || globalState.cachedPanes;
  panesToSync.forEach((pane, index) => {
    (pane as HTMLElement).dataset.currentIndex = index.toString();
  });
};
