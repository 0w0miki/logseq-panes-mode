import { getPaneIdFromPane } from '../../core/domUtils';
import { globalState } from '../../core/pluginGlobalState';
import {
  readLastActivePanesFromStorage,
  readPanesOrderFromStorage,
  writeLastActiveToStorage,
  writePanesOrderToStorage,
} from '../../core/storage';
import { debounce } from '../../core/utils';
import { getCurrentSidebarPanes } from './paneCache';

export const updatePanesOrderInStorage = (currentSidebarPanes?: Element[]): void => {
  const currentPanes = currentSidebarPanes || getCurrentSidebarPanes();
  const newPanesOrder = currentPanes.map(pane => getPaneIdFromPane(pane));
  if (!Array.isArray(newPanesOrder)) return;
  writePanesOrderToStorage(newPanesOrder);
};

export const getInitialPanesOrder = (): string[] => readPanesOrderFromStorage();

let lastActivePanesCache: string[] | null = null;

export const getLastActivePanes = (): string[] => {
  if (lastActivePanesCache === null) {
    lastActivePanesCache = readLastActivePanesFromStorage();
  }

  return lastActivePanesCache;
};

export const addToLastActivePanes = (
  activePaneIndex?: number,
  currentSidebarPanes?: Element[]
): void => {
  const paneIndex = activePaneIndex ?? globalState.currentActivePaneIndex;
  if (paneIndex === null) return;

  const currentPane = currentSidebarPanes?.[paneIndex];
  if (!currentPane) return;

  const currentPaneId = getPaneIdFromPane(currentPane);
  if (!currentPaneId) return;

  const current = getLastActivePanes();

  if (current[current.length - 1] === currentPaneId) return;

  lastActivePanesCache = current.filter(id => id !== currentPaneId);
  lastActivePanesCache.push(currentPaneId);

  debouncedWriteLastActive(lastActivePanesCache.slice(-globalState.maxTabs));
};

export const removeFromLastActivePanes = (paneId: string): void => {
  if (lastActivePanesCache === null) return;
  lastActivePanesCache = lastActivePanesCache.filter(id => id !== paneId);
};

export const invalidateLastActivePanesCache = (): void => {
  lastActivePanesCache = null;
};

const debouncedWriteLastActive = debounce((topIds: string[]) => {
  writeLastActiveToStorage(topIds);
}, 300);
