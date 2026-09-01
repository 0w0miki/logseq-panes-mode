import { getPaneCloseButton, getResolvedPaneId } from '../../core/domUtils';
import { globalState } from '../../core/pluginGlobalState';
import { getLastActivePanes } from './panePersistence';
import { getCurrentSidebarPanes, refreshPanesElementsCache } from './paneCache';
import {
  applyPaneDimensions,
  clearPaneDimensions,
  disconnectPaneCollapseObserver,
  removeScrollListenerFromPane,
} from './paneLayout';
import { setActivePaneByIndex } from './paneNavigation';
import { getPluginSettings } from '../../core/pluginSettings';
import { waitForDomChanges } from '../../core/utils';
import { updateTabs } from '../tabs/tabs';

export const togglePaneCollapse = (index: number) => {
  if (index < 0 || index >= globalState.cachedPanes.length) return;
  const pane = globalState.cachedPanes[index];
  const collapseButton = pane.querySelector('.rotating-arrow') as HTMLElement;
  if (!collapseButton) return;
  const wasCollapsed = pane.classList.contains('collapsed');
  collapseButton.click();
  void waitForDomChanges(() => {
    const isCollapsedNow = pane.classList.contains('collapsed');
    if (wasCollapsed === isCollapsedNow) return;
    if (!isCollapsedNow) {
      applyPaneDimensions(pane as HTMLElement);
    } else {
      clearPaneDimensions(pane);
    }
    updateTabs(globalState.cachedPanes);
    if (globalState.currentActivePaneIndex !== null) {
      setActivePaneByIndex(globalState.currentActivePaneIndex, globalState.cachedPanes);
    }
  }, 0.15);
};

export const closePaneByIndex = (paneIndex: number) => {
  const pane = globalState.cachedPanes[paneIndex];
  if (!pane) return;
  const closeButton = getPaneCloseButton(pane);
  if (!closeButton) return;

  cleanupPaneListeners(pane);
  closeButton.click();
};

export const closePaneByIndexes = async (
  paneIndexes: number[]
) => {
  for (const index of paneIndexes.sort((a, b) => b - a)) {
    closePaneByIndex(index);
    await waitForDomChanges();
  }
};

export const enforceMaxTabsLimit = async (): Promise<void> => {
  const settings = getPluginSettings();
  if (!settings.autoCloseOldestTab) return;

  const panes = getCurrentSidebarPanes();
  if (panes.length <= globalState.maxTabs) return;

  const lastActivePanesIds = await getLastActivePanes();
  const oldestPaneId = lastActivePanesIds[0];
  if (oldestPaneId === undefined) return;

  // Resolve every pane to its final id so matching uses the same keys that
  // addToLastActivePanes wrote (uuid preferred, cached fallback otherwise).
  const resolvedIds = await Promise.all(panes.map(pane => getResolvedPaneId(pane)));
  const indexToClose = panes.findIndex((_pane, index) => {
    const id = resolvedIds[index];

    return id !== null && id === oldestPaneId;
  });
  const safeIndex = indexToClose >= 0 ? indexToClose : 0;
  if (safeIndex >= 0 && safeIndex < panes.length) {
    closePaneByIndex(safeIndex);
  }
};

export const cleanUnusedPanes = async (): Promise<void> => {
  const lastActivePanesIds = (await getLastActivePanes()).slice(-globalState.maxTabs);
  if (!lastActivePanesIds || lastActivePanesIds.length === 0) {
    refreshTabsFromCurrentPanes();
    return;
  }
  const currentPanes = getCurrentSidebarPanes();
  refreshPanesElementsCache(currentPanes);
  const activeIndex = globalState.currentActivePaneIndex;
  const resolvedIds = await Promise.all(currentPanes.map(pane => getResolvedPaneId(pane)));
  const panesToClose: number[] = [];
  currentPanes.forEach((_pane, index) => {
    // Never auto-close the pane the user is currently looking at.
    if (index === activeIndex) return;
    // Match by the same resolved keys that addToLastActivePanes stored; a
    // pane's own key is in the list if it was activated or merged on init.
    const paneId = resolvedIds[index];
    if (paneId && !lastActivePanesIds.includes(paneId)) {
      panesToClose.push(index);
    }
  });
  if (panesToClose.length > 0) {
    void closePaneByIndexes(panesToClose);
  } else {
    refreshTabsFromCurrentPanes();
  }
};

const cleanupPaneListeners = (pane: Element): void => {
  removeScrollListenerFromPane(pane);
  disconnectPaneCollapseObserver(pane);
};

const refreshTabsFromCurrentPanes = () => {
  const currentPanes = getCurrentSidebarPanes();
  refreshPanesElementsCache(currentPanes);
  updateTabs(currentPanes);
};