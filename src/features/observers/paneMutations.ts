import { APP_SETTINGS_CONFIG } from '../../core/constants';
import { debugLog, debugWarn } from '../../core/logger';
import { globalState } from '../../core/pluginGlobalState';
import type { PendingShiftClick } from '../panes/shiftActions/types';
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
import {
  getActivePaneElement,
  reorderPaneNextToActive,
  resolveActivePaneFromPending,
  resolveShiftClickTargetPane,
} from '../panes/shiftActions/paneShiftReorder';
import { EXPECTED_MUTATIONS } from './types';
import { getPluginSettings } from '../../core/pluginSettings';

const SHIFT_CLICK_TIMEOUT_MS = 2000;
const PANE_SYNC_INTERVAL_MS = 100;
const SHIFT_CLICK_WATCHER_INTERVAL_MS = 50;
const TAB_SELECTOR = '.panesMode-tab';

let paneOrderSyncInterval: ReturnType<typeof setInterval> | null = null;
let paneOrderSyncTarget: Element[] | null = null;
let moduleResizeObserver: ResizeObserver | null = null;
let shiftClickWatcherInterval: ReturnType<typeof setInterval> | null = null;
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

export const stopShiftClickPaneWatcher = (): void => {
  if (shiftClickWatcherInterval !== null) {
    clearInterval(shiftClickWatcherInterval);
    shiftClickWatcherInterval = null;
  }
};

export const startShiftClickPaneWatcher = (): void => {
  stopShiftClickPaneWatcher();

  const pending = globalState.pendingShiftClick;
  if (!pending) return;

  const watcherTimestamp = pending.timestamp;

  shiftClickWatcherInterval = setInterval(() => {
    const currentPending = globalState.pendingShiftClick;

    // Already consumed or replaced by another shift+click — stop
    if (!currentPending || currentPending.timestamp !== watcherTimestamp) {
      stopShiftClickPaneWatcher();

      return;
    }

    // Timeout — clear stale pending
    if (Date.now() - currentPending.timestamp > SHIFT_CLICK_TIMEOUT_MS) {
      globalState.pendingShiftClick = null;
      stopShiftClickPaneWatcher();

      return;
    }
  }, SHIFT_CLICK_WATCHER_INTERVAL_MS);
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

    const container = getScrollablePanesContainer();
    if (!container) return;

    if (!paneOrderSyncTarget || paneOrderSyncTarget.length === 0) {
      stopPaneOrderSync();

      return;
    }

    const existingPanesFromOrder = paneOrderSyncTarget.filter(
      pane => pane.isConnected && container.contains(pane)
    );

    if (existingPanesFromOrder.length === 0) {
      stopPaneOrderSync();

      return;
    }
    paneOrderSyncTarget = existingPanesFromOrder;

    const currentDomPanes = getCurrentSidebarPanes(container);
    const panesInPlace = !arePanesDifferent(existingPanesFromOrder, currentDomPanes);

    if (!panesInPlace) {
      existingPanesFromOrder.forEach((pane, index) => {
        if (container.children[index] === pane) return;
        const referenceNode = container.children[index] ?? null;
        container.insertBefore(pane, referenceNode);
      });
    }

    const updatedPanes = getCurrentSidebarPanes(container);
    const tabsSynced = areTabsSyncedWithPanes(updatedPanes);
    if (!panesInPlace || !tabsSynced) {
      refreshPanesElementsCache(updatedPanes);
      updatePanesOrderInStorage(updatedPanes);
      updateTabs(updatedPanes);
    }

    if (!arePanesDifferent(existingPanesFromOrder, updatedPanes) && tabsSynced) {
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

const handleClose = (closedPanes: Set<Element>, currentPanes: Element[]): boolean => {
  debugLog('[PanesMode] handleClose:', { closedCount: closedPanes.size, remainingCount: currentPanes.length });

  if (currentPanes.length === 0) {
    debugLog('[PanesMode] handleClose: last pane closed, hiding sidebar');
    logseq.App.setRightSidebarVisible(false);
    globalState.currentActivePaneIndex = null;
    refreshPanesElementsCache([]);
    updateTabs([]);

    return true;
  }

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
  if (adjustedActiveIndex !== null && adjustedActiveIndex >= 0) {
    setActivePaneByIndex(adjustedActiveIndex, currentPanes);
  }
  globalState.cachedPanes = globalState.cachedPanes.filter(p => !closedPanes.has(p));

  return false;
};

const handleNewPanes = (
  newPanes: Set<Element>,
  currentPanes: Element[],
  resizeObserver: ResizeObserver
): void => {
  const pluginSettings = getPluginSettings();
  const container = getScrollablePanesContainer();
  if (!container) return;

  if (pluginSettings.autoCloseOldestTab) {
    enforceMaxTabsLimit();
  }

  globalState.expectedMutations.push(EXPECTED_MUTATIONS.newSidebarItemsReordering);

  const activePane = getActivePaneElement(currentPanes);
  const activePos = activePane ? currentPanes.indexOf(activePane) : -1;

  for (const newPane of newPanes) {
    observePaneForResize(resizeObserver, newPane);
    enableFitContentForNewPane(newPane);
    applyPaneDimensions(newPane as HTMLElement);

    if (globalState.alwaysOpenPanesAtBegining) {
      container.insertBefore(newPane, container.firstChild);
      globalState.cachedPanes.unshift(newPane);
    } else if (activePos !== -1) {
      container.insertBefore(newPane, currentPanes[activePos + 1] ?? null);
      globalState.cachedPanes.splice(activePos + 1, 0, newPane);
    }
  }

  if (newPanes.size > 0) {
    syncPaneIndices(globalState.cachedPanes);
    const updatedPanes = getCurrentSidebarPanes(container);
    const newPaneIndex = globalState.alwaysOpenPanesAtBegining ? 0 : activePos + 1;
    setActivePaneByIndex(newPaneIndex, updatedPanes, true);
  }

  notifyVirtuosoScroll();
};

const finalize = (currentPanes: Element[]): void => {
  debugLog('[PanesMode] finalize:', { panesCount: currentPanes.length });
  updatePanesOrderInStorage(currentPanes);
  updateTabs(currentPanes);
  ensurePaneOrderAndTabsSync(currentPanes);
  refreshPanesElementsCache();
  debugLog('[PanesMode] finalize:', { activeIndex: globalState.currentActivePaneIndex, panesCount: currentPanes.length });
};

// --- Shift click ---

const getFreshPendingShiftClick = (): PendingShiftClick | null => {
  const pending = globalState.pendingShiftClick;
  if (!pending) return null;
  if (Date.now() - pending.timestamp > SHIFT_CLICK_TIMEOUT_MS) {
    globalState.pendingShiftClick = null;

    return null;
  }

  return pending;
};

const handleShiftClickPaneOpen = (
  pending: PendingShiftClick,
  currentSidebarPanes: Element[],
  resizeObserver: ResizeObserver,
  newPanes: Set<Element>
): boolean => {
  const container = getScrollablePanesContainer();
  if (!container) return false;

  const allowNewPane = !pending.searchSection || pending.searchSection === 'block';
  const newPaneCandidate = allowNewPane ? newPanes.values().next().value : undefined;
  const targetPane =
    newPaneCandidate ?? resolveShiftClickTargetPane(pending, currentSidebarPanes);
  if (!targetPane) return false;

  const isNewPane = newPanes.has(targetPane);
  if (isNewPane) {
    const newPaneId = getPaneIdFromPane(targetPane);
    enforceMaxTabsLimit(newPaneId || undefined);
    observePaneForResize(resizeObserver, targetPane);
    enableFitContentForNewPane(targetPane);
    applyPaneDimensions(targetPane as HTMLElement);
  }

  const activePane = resolveActivePaneFromPending(pending, currentSidebarPanes);
  const reordered = reorderPaneNextToActive(targetPane, activePane, container);
  if (!reordered) {
    globalState.pendingShiftClick = null;

    return false;
  }

  const indexToFocus = reordered.indexOf(targetPane);
  if (indexToFocus !== -1) {
    setActivePaneByIndex(indexToFocus, reordered, isNewPane);
  }

  notifyVirtuosoScroll();
  globalState.pendingShiftClick = null;

  return true;
};

// --- Main observer ---

export const createPanesMutationObserver = (resizeObserver: ResizeObserver): MutationObserver => {
  moduleResizeObserver = resizeObserver;

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

    // Pane(s) closed
    let lastPaneClosed = false;
    if (closedPanes.size > 0) {
      lastPaneClosed = handleClose(closedPanes, currentSidebarPanes);
    }

    // Shift+click pending — handles its own reorder/post-processing
    if (lastPaneClosed) return;

    const pendingShiftClick = getFreshPendingShiftClick();
    if (pendingShiftClick) {
      debugLog('[PanesMode] observer: got pending shift-click:', pendingShiftClick);
      const handled = handleShiftClickPaneOpen(pendingShiftClick, currentSidebarPanes, resizeObserver, newPanes);
      if (handled) {
        stopShiftClickPaneWatcher();
        finalize(getCurrentSidebarPanes());
        return;
      }
    }

    // New pane(s) opened
    if (newPanes.size > 0) {
      handleNewPanes(newPanes, currentSidebarPanes, resizeObserver);
    }

    // Reorder — restore to cached order
    if (reorderedPanes.size > 0) {
      const reorderContainer = getScrollablePanesContainer();
      if (reorderContainer) {
        restoreCachedPaneOrder(reorderContainer);
      }
    }

    finalize(getCurrentSidebarPanes());
  });
};

export const startPanesMutationObserver = (observer: MutationObserver): void => {
  attachPanesObserver(observer);
  refreshContainerWatchdog(observer);

  void waitForDomChanges(() => {
    reconcileMissedPaneChange(observer);
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

const refreshContainerWatchdog = (panesObserver: MutationObserver): void => {
  const panesContainer = getScrollablePanesContainer();
  const nextWatchdogHost = panesContainer?.parentElement as HTMLElement | null;
  if (!nextWatchdogHost) return;

  if (!containerWatchdogObserver) {
    containerWatchdogObserver = new MutationObserver(() => {
      if (!globalState.isPanesModeModeActive) return;

      refreshContainerWatchdog(panesObserver);
      reconcileMissedPaneChange(panesObserver);
    });
  }

  if (containerWatchdogHost === nextWatchdogHost) return;

  containerWatchdogObserver.disconnect();
  containerWatchdogObserver.observe(nextWatchdogHost, { childList: true });
  containerWatchdogHost = nextWatchdogHost;
};

const reconcileMissedPaneChange = (panesObserver: MutationObserver): void => {
  const currentContainer = attachPanesObserver(panesObserver);
  if (!currentContainer) return;

  refreshContainerWatchdog(panesObserver);

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
    if (activeInNewDom) {
      activeInNewDom.classList.add('selectedPane');
    }

    globalState.expectedMutations.push(EXPECTED_MUTATIONS.newSidebarItemsReordering);

    if (globalState.alwaysOpenPanesAtBegining) {
      for (let i = genuinelyNewPanes.length - 1; i >= 0; i--) {
        currentContainer.insertBefore(genuinelyNewPanes[i], currentContainer.firstChild);
      }
    } else if (activeInNewDom) {
      let referenceNode: Element | null = activeInNewDom.nextElementSibling;
      genuinelyNewPanes.forEach(newPane => {
        currentContainer.insertBefore(newPane, referenceNode);
        referenceNode = newPane.nextElementSibling;
      });
    }

    genuinelyNewPanes.forEach(newPane => {
      if (moduleResizeObserver) {
        observePaneForResize(moduleResizeObserver, newPane);
      }
      enableFitContentForNewPane(newPane);
      applyPaneDimensions(newPane as HTMLElement);
    });
  }

  const updatedPanes = getCurrentSidebarPanes(currentContainer);
  refreshPanesElementsCache(updatedPanes);
  updatePanesOrderInStorage(updatedPanes);
  updateTabs(updatedPanes);

  if (genuinelyNewPanes.length > 0) {
    const lastNewPane = genuinelyNewPanes[genuinelyNewPanes.length - 1];
    const newPaneIndex = updatedPanes.indexOf(lastNewPane);
    if (newPaneIndex !== -1) {
      setActivePaneByIndex(newPaneIndex, updatedPanes, true);
    }
  } else if (activeInNewDom) {
    const activeIndex = updatedPanes.indexOf(activeInNewDom);
    if (activeIndex !== -1) {
      setActivePaneByIndex(activeIndex, updatedPanes);
    }
  } else if (updatedPanes.length > 0) {
    setActivePaneByIndex(0, updatedPanes);
  }

  if (genuinelyNewPanes.length > 0) {
    notifyVirtuosoScroll();
  }
};
