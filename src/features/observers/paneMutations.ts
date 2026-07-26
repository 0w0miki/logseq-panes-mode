import { APP_SETTINGS_CONFIG } from '../../core/constants';
import { debugLog, debugWarn } from '../../core/logger';
import { globalState } from '../../core/pluginGlobalState';
import { waitForDomChanges } from '../../core/utils';
import {
  arePanesDifferent,
  getPaneIdFromPane,
  getScrollablePanesContainer,
  getTabsContainer,
} from '../../core/domUtils';
import { getCurrentSidebarPanes, refreshPanesElementsCache, syncPaneIndices } from '../panes/paneCache';
import { setActivePaneByIndex } from '../panes/paneNavigation';
import { observePaneForResize } from '../panes/paneResize';
import { updateTabs } from '../tabs/tabs';
import { enforceMaxTabsLimit } from '../panes/paneActions';
import {
  applyPaneDimensions,
  enableFitContentForNewPane,
  notifyVirtuosoScroll,
} from '../panes/paneLayout';
import { updatePanesOrderInStorage } from '../panes/panePersistence';
import { EXPECTED_MUTATIONS } from './types';
import { getPluginSettings } from '../../core/pluginSettings';

const PANE_SYNC_INTERVAL_MS = 100;
const TAB_SELECTOR = '.panesMode-tab';

let paneOrderSyncInterval: ReturnType<typeof setInterval> | null = null;
let paneOrderSyncTarget: Element[] | null = null;
let containerWatchdogObserver: MutationObserver | null = null;
let containerWatchdogHost: HTMLElement | null = null;
let containerWatchdogElement: HTMLElement | null = null;

export const stopPaneOrderSync = (): void => {
  if (paneOrderSyncInterval !== null) {
    clearInterval(paneOrderSyncInterval);
    paneOrderSyncInterval = null;
  }
  paneOrderSyncTarget = null;
};

const areTabsSyncedWithPanes = (panes: Element[]): boolean => {
  const tabsContainer = getTabsContainer(APP_SETTINGS_CONFIG.isVerticalTabs);
  if (!tabsContainer) return false;
  const tabs = Array.from(tabsContainer.querySelectorAll<HTMLElement>(`:scope > ${TAB_SELECTOR}`));
  if (tabs.length !== panes.length) return false;

  return tabs.every((tab, index) => {
    const paneId = getPaneIdFromPane(panes[index]) || `pane-${index}`;
    return tab.dataset.paneId === paneId;
  });
};

const ensurePaneOrderAndTabsSync = (newPanesOrder: Element[]): void => {
  paneOrderSyncTarget = newPanesOrder.slice();
  if (paneOrderSyncInterval !== null) return;

  paneOrderSyncInterval = setInterval(() => {
    if (!globalState.isPanesModeModeActive) {
      stopPaneOrderSync();
      return;
    }

    if (!paneOrderSyncTarget || paneOrderSyncTarget.length === 0) {
      stopPaneOrderSync();
      return;
    }

    const container = getScrollablePanesContainer();
    if (!container) return;

    const currentDomPanes = getCurrentSidebarPanes(container);
    const { newPanes, closedPanes, reorderedPanes } = diffPanes(paneOrderSyncTarget, currentDomPanes);

    if (newPanes.size > 0 || closedPanes.size > 0) {
      stopPaneOrderSync();
      return;
    }

    if (reorderedPanes.size > 0) {
      paneOrderSyncTarget = paneOrderSyncTarget.filter(p => currentDomPanes.includes(p));
      restoreCachedPaneOrder(container);
    }

    const updatedPanes = getCurrentSidebarPanes(container);
    const tabsSynced = areTabsSyncedWithPanes(updatedPanes);
    if (reorderedPanes.size > 0 || !tabsSynced) {
      refreshPanesElementsCache(updatedPanes);
      updatePanesOrderInStorage(updatedPanes);
      updateTabs(updatedPanes);
    }

    if (!arePanesDifferent(paneOrderSyncTarget, updatedPanes) && tabsSynced) {
      stopPaneOrderSync();
    }
  }, PANE_SYNC_INTERVAL_MS);
};

const restoreCachedPaneOrder = (container: HTMLElement): void => {
  let didMutate = false;
  globalState.cachedPanes.forEach((pane, index) => {
    const currentPanes = getCurrentSidebarPanes(container);
    if (currentPanes[index] === pane) return;
    if (!didMutate) {
      globalState.expectedMutations.push(EXPECTED_MUTATIONS.newSidebarItemsReordering);
      didMutate = true;
    }
    const referenceNode = currentPanes[index] ?? null;
    container.insertBefore(pane, referenceNode);
  });
  updatePanesOrderInStorage(getCurrentSidebarPanes(container));
  notifyVirtuosoScroll();
};

// --- Pane diffing ---

type PaneDiff = {
  newPanes: Set<Element>;
  closedPanes: Set<Element>;
  reorderedPanes: Set<Element>;
};

const diffPanes = (cached: Element[], current: Element[]): PaneDiff => {
  const newPanes = new Set(current.filter(p => !cached.includes(p)));
  const closedPanes = new Set(cached.filter(p => !current.includes(p)));
  const reorderedPanes = new Set(
    cached.filter(p => current.includes(p) && current.indexOf(p) !== cached.indexOf(p))
  );

  if (closedPanes.size > 0 || newPanes.size > 0 || reorderedPanes.size > 0) {
    debugLog('[PanesMode] diffPanes:', {
      cacheCount: cached.length,
      currentCount: current.length,
      newCount: newPanes.size,
      closedCount: closedPanes.size,
      reorderedCount: reorderedPanes.size,
    });
  }

  return { newPanes, closedPanes, reorderedPanes };
};

// --- Pane change handlers ---

const handleClose = (closedPanes: Set<Element>, currentPanes: Element[]): void => {
  debugLog('[PanesMode] handleClose:', { closedCount: closedPanes.size, remainingCount: currentPanes.length });

  const activeIndex = globalState.currentActivePaneIndex;
  // Process closes in reverse order so earlier index adjustments don't affect later ones
  const sortedIndices = [...closedPanes]
    .map(p => globalState.cachedPanes.indexOf(p))
    .filter(i => i !== -1)
    .sort((a, b) => b - a);

  let adjustedActiveIndex = activeIndex;

  for (const closedPaneIndex of sortedIndices) {
    if (adjustedActiveIndex !== null) {
      if (closedPaneIndex === adjustedActiveIndex) {
        adjustedActiveIndex = Math.min(closedPaneIndex, currentPanes.length - 1);
      } else if (closedPaneIndex < adjustedActiveIndex) {
        adjustedActiveIndex = Math.max(0, adjustedActiveIndex - 1);
      }
    }
  }

  debugLog('[PanesMode] handleClose: activeIndex', { before: activeIndex, after: adjustedActiveIndex });
  if (adjustedActiveIndex !== null) {
    globalState.currentActivePaneIndex = adjustedActiveIndex;
  }
  globalState.cachedPanes = globalState.cachedPanes.filter(p => !closedPanes.has(p));
};

const handleNewPanes = (
  newPanes: Set<Element>,
  resizeObserver: ResizeObserver
): void => {
  if (getPluginSettings().autoCloseOldestTab) {
    enforceMaxTabsLimit();
  }

  const activeIndex = globalState.currentActivePaneIndex;
  const activePos =
    activeIndex !== null && activeIndex < globalState.cachedPanes.length ? activeIndex : -1;

  for (const newPane of newPanes) {
    debugLog('[PanesMode] handleNewPanes: new pane', newPane.innerHTML, getPaneIdFromPane(newPane));
    observePaneForResize(resizeObserver, newPane);
    enableFitContentForNewPane(newPane);
    applyPaneDimensions(newPane as HTMLElement);

    if (globalState.alwaysOpenPanesAtBegining) {
      globalState.cachedPanes.unshift(newPane);
    } else if (activePos !== -1) {
      globalState.cachedPanes.splice(activePos + 1, 0, newPane);
    }
  }

  if (newPanes.size > 0) {
    syncPaneIndices(globalState.cachedPanes);
    const newPaneIndex = globalState.alwaysOpenPanesAtBegining ? 0 : activePos + 1;
    globalState.currentActivePaneIndex = newPaneIndex;
  }
};

const finalize = (currentPanes: Element[]): void => {
  debugLog('[PanesMode] finalize:', { panesCount: currentPanes.length });
  updatePanesOrderInStorage(currentPanes);
  updateTabs(currentPanes);
  ensurePaneOrderAndTabsSync(currentPanes);
  refreshPanesElementsCache();
  debugLog('[PanesMode] finalize:', { activeIndex: globalState.currentActivePaneIndex, panesCount: currentPanes.length });
};

// --- Main observer ---

export const createPanesMutationObserver = (resizeObserver: ResizeObserver): MutationObserver => {
  return new MutationObserver(() => {
    const currentSidebarPanes = getCurrentSidebarPanes();
    const { newPanes, closedPanes, reorderedPanes } = diffPanes(globalState.cachedPanes, currentSidebarPanes);

    // Expected mutations: plugin-initiated DOM change, skip and let plugin handle it
    if (globalState.expectedMutations.length > 0) {
      const expectedMutation = globalState.expectedMutations.shift();
      debugLog('Expected mutation detected:', expectedMutation);
      refreshPanesElementsCache(currentSidebarPanes);
      if (expectedMutation === EXPECTED_MUTATIONS.dragAndDropItemReordering) {
        updateTabs(currentSidebarPanes);
        ensurePaneOrderAndTabsSync(currentSidebarPanes);
      }

      return;
    }

    // Nothing changed
    if (newPanes.size === 0 && closedPanes.size === 0 && reorderedPanes.size === 0) {
      debugLog('[PanesMode] observer: no diff, skipping');
      return;
    }

    // All pane closed — hide sidebar, nothing else to do
    if (currentSidebarPanes.length === 0) {
      logseq.App.setRightSidebarVisible(false);
      globalState.currentActivePaneIndex = null;
      refreshPanesElementsCache([]);
      updateTabs([]);
      return;
    }

    // Pane(s) closed
    if (closedPanes.size > 0) {
      handleClose(closedPanes, currentSidebarPanes);
    }

    // New pane(s) opened
    if (newPanes.size > 0) {
      handleNewPanes(newPanes, resizeObserver);
    }

    // Reorder — restore to cached order
    const reorderContainer = getScrollablePanesContainer();
    if (reorderContainer) {
      restoreCachedPaneOrder(reorderContainer);
    }

    if (globalState.currentActivePaneIndex !== null) {
      setActivePaneByIndex(globalState.currentActivePaneIndex, undefined, false, 1, undefined, false, true);
    }

    finalize(getCurrentSidebarPanes());
  });
};

export const startPanesMutationObserver = (
  observer: MutationObserver,
  resizeObserver: ResizeObserver,
): void => {
  attachPanesObserver(observer);
  refreshContainerWatchdog(observer, resizeObserver);

  void waitForDomChanges(() => {
    reconcileMissedPaneChange(observer, resizeObserver);
  }, 0.5);
};

export const stopContainerWatchdog = (): void => {
  containerWatchdogObserver?.disconnect();
  containerWatchdogObserver = null;
  containerWatchdogHost = null;
  containerWatchdogElement = null;
};

const attachPanesObserver = (panesObserver: MutationObserver): HTMLElement | null => {
  const panesContainer = getScrollablePanesContainer();
  if (!panesContainer) {
    debugWarn('Panes container not found, skipping mutation observer setup.');

    return null;
  }

  if (containerWatchdogElement !== panesContainer) {
    panesObserver.disconnect();
    panesObserver.observe(panesContainer, { childList: true });
    containerWatchdogElement = panesContainer;
  }

  return panesContainer;
};

const refreshContainerWatchdog = (
  panesObserver: MutationObserver,
  resizeObserver: ResizeObserver,
): void => {
  const panesContainer = getScrollablePanesContainer();
  const containerParent = panesContainer?.parentElement as HTMLElement | null;
  if (!containerParent) return;

  if (!containerWatchdogObserver) {
    containerWatchdogObserver = new MutationObserver(() => {
      if (!globalState.isPanesModeModeActive) return;

      reconcileMissedPaneChange(panesObserver, resizeObserver);
    });
  }

  if (containerWatchdogHost === containerParent) return;

  containerWatchdogObserver.disconnect();
  containerWatchdogObserver.observe(containerParent, { childList: true });
  containerWatchdogHost = containerParent;
};

const reconcileMissedPaneChange = (
  panesObserver: MutationObserver,
  resizeObserver: ResizeObserver,
): void => {
  const currentContainer = attachPanesObserver(panesObserver);
  if (!currentContainer) return;

  const currentPanes = getCurrentSidebarPanes(currentContainer);
  if (!arePanesDifferent(globalState.cachedPanes, currentPanes)) return;

  debugLog('[PanesMode] Watchdog detected pane change missed by observer', {
    cached: globalState.cachedPanes.length,
    current: currentPanes.length,
  });

  // When Logseq replaces the container, ALL DOM elements are new — match by ID
  // to find which panes are genuinely new vs re-created existing ones.
  const cachedPaneIds = new Set(
    globalState.cachedPanes.map(p => getPaneIdFromPane(p)).filter(Boolean)
  );
  const genuinelyNewPanes = currentPanes.filter(pane => {
    const id = getPaneIdFromPane(pane);

    return !id || !cachedPaneIds.has(id);
  });

  // Find the previously active pane in the new DOM (by ID)
  const previousActivePane =
    globalState.currentActivePaneIndex !== null
      ? globalState.cachedPanes[globalState.currentActivePaneIndex]
      : null;
  const previousActivePaneId = previousActivePane ? getPaneIdFromPane(previousActivePane) : null;
  const activeInNewDom = previousActivePaneId
    ? currentPanes.find(p => getPaneIdFromPane(p) === previousActivePaneId)
    : null;

  // Position genuinely new panes after the (previously) active pane.
  if (genuinelyNewPanes.length > 0) {
    globalState.expectedMutations.push(EXPECTED_MUTATIONS.newSidebarItemsReordering);

    genuinelyNewPanes.forEach(newPane => {
      observePaneForResize(resizeObserver, newPane);
      enableFitContentForNewPane(newPane);
      applyPaneDimensions(newPane as HTMLElement);

      if (globalState.alwaysOpenPanesAtBegining) {
        currentContainer.insertBefore(newPane, currentContainer.firstChild);
      } else if (activeInNewDom) {
        currentContainer.insertBefore(newPane, activeInNewDom.nextElementSibling);
      };
    });
  }

  const updatedPanes = getCurrentSidebarPanes(currentContainer);
  refreshPanesElementsCache(updatedPanes);
  updatePanesOrderInStorage(updatedPanes);
  updateTabs(updatedPanes);

  let activeIndex = -1;
  if (genuinelyNewPanes.length > 0) {
    const lastNewPane = genuinelyNewPanes[genuinelyNewPanes.length - 1];
    activeIndex = updatedPanes.indexOf(lastNewPane);
  } else if (activeInNewDom) {
    activeIndex = updatedPanes.indexOf(activeInNewDom);
  }
  setActivePaneByIndex(activeIndex === -1 ? 0 : activeIndex, updatedPanes);

  if (genuinelyNewPanes.length > 0) {
    notifyVirtuosoScroll();
  }
};
