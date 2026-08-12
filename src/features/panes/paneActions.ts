import { getPaneCloseButton, getPaneIdFromPane } from '../../core/domUtils';
import { isActivePaneIndexValid, globalState } from '../../core/pluginGlobalState';
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

type CurrentPaneState = {
  panes: Element[];
  activePane: Element | null;
  activeIndex: number | null;
};

type PendingPaneCloseTarget = {
  pane: Element;
  paneId: string | null;
};

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

export const closePaneByIndexes = (
  paneIndexes: number[]
) => {
  const currentPanes = getCurrentSidebarPanes();
  const panesToClose = buildPendingPaneCloseTargets(paneIndexes, currentPanes);
  if (panesToClose.length === 0) return;

  void closePaneTargetsSequentially(panesToClose);
};

export const enforceMaxTabsLimit = (excludePageId?: string): void => {
  const settings = getPluginSettings();
  if (!settings.autoCloseOldestTab) return;
  const panes = getCurrentSidebarPanes();
  if (panes.length <= globalState.maxTabs) return;
  const lastActivePanesIds = getLastActivePanes();
  const oldestPaneId = lastActivePanesIds[0];
  const indexToClose =
    oldestPaneId !== undefined
      ? panes.findIndex(pane => {
          const paneId = getPaneIdFromPane(pane);
          if (excludePageId && paneId === excludePageId) return false;

          return paneId === oldestPaneId;
        })
      : -1;
  const fallbackIndex = panes.findIndex(pane => getPaneIdFromPane(pane) !== excludePageId);
  const safeIndex = indexToClose >= 0 ? indexToClose : fallbackIndex;
  if (safeIndex >= 0 && safeIndex < panes.length) {
    closePaneByIndex(safeIndex);
  }
};

export const cleanUnusedPanes = () => {
  const lastActivePanesIds = getLastActivePanes().slice(-globalState.maxTabs);
  if (!lastActivePanesIds || lastActivePanesIds.length === 0) {
    refreshTabsFromCurrentPanes();

    return;
  }
  const { panes: currentPanes } = getResolvedCurrentPaneState();
  const panesToClose: number[] = [];
  currentPanes.forEach((pane, index) => {
    const paneId = getPaneIdFromPane(pane);
    if (paneId && !lastActivePanesIds.includes(paneId)) {
      panesToClose.push(index);
    }
  });
  if (panesToClose.length > 0) {
    closePaneByIndexes(panesToClose);
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

const buildPendingPaneCloseTargets = (
  paneIndexes: number[],
  currentPanes: Element[]
): PendingPaneCloseTarget[] =>
  paneIndexes
    .map(index => currentPanes[index])
    .filter((pane): pane is Element => Boolean(pane))
    .map(pane => ({
      pane,
      paneId: getPaneIdFromPane(pane),
    }));

const resolvePendingPaneCloseTarget = (
  target: PendingPaneCloseTarget,
  currentPanes: Element[]
): Element | null => {
  if (currentPanes.includes(target.pane)) {
    return target.pane;
  }

  if (!target.paneId) return null;

  return currentPanes.find(pane => getPaneIdFromPane(pane) === target.paneId) ?? null;
};

const closePaneTargetsSequentially = async (targets: PendingPaneCloseTarget[]): Promise<number> => {
  let closedCount = 0;

  for (const target of targets) {
    const currentPanes = getCurrentSidebarPanes();
    const pane = resolvePendingPaneCloseTarget(target, currentPanes);
    if (!pane) continue;

    const closeButton = getPaneCloseButton(pane);
    if (!closeButton) continue;

    cleanupPaneListeners(pane);
    closeButton.click();
    closedCount++;

    await waitForDomChanges();
  }

  return closedCount;
};

const getResolvedCurrentPaneState = (): CurrentPaneState => {
  const previousCachedPanes =
    globalState.cachedPanes.length > 0 ? [...globalState.cachedPanes] : getCurrentSidebarPanes();
  const previousActivePane =
    globalState.currentActivePaneIndex !== null
      ? previousCachedPanes[globalState.currentActivePaneIndex] ?? null
      : null;
  const previousActivePaneId = previousActivePane ? getPaneIdFromPane(previousActivePane) : null;

  const panes = getCurrentSidebarPanes();
  refreshPanesElementsCache(panes);

  if (panes.length === 0) {
    globalState.currentActivePaneIndex = null;

    return { panes, activePane: null, activeIndex: null };
  }

  const selectedPane =
    panes.find(pane => (pane as HTMLElement).classList.contains('selectedPane')) ?? null;
  const matchedPreviousPane =
    previousActivePane && panes.includes(previousActivePane) ? previousActivePane : null;
  const matchedPaneById =
    !matchedPreviousPane && previousActivePaneId
      ? panes.find(pane => getPaneIdFromPane(pane) === previousActivePaneId) ?? null
      : null;
  const matchedPaneByIndex = isActivePaneIndexValid(panes)
    ? panes[globalState.currentActivePaneIndex as number] ?? null
    : null;
  const activePane =
    selectedPane ?? matchedPreviousPane ?? matchedPaneById ?? matchedPaneByIndex ?? panes[0];
  const activeIndex = panes.indexOf(activePane);

  globalState.currentActivePaneIndex = activeIndex === -1 ? 0 : activeIndex;

  return {
    panes,
    activePane,
    activeIndex: globalState.currentActivePaneIndex,
  };
};