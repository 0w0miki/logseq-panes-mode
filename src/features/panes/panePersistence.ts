import { getResolvedPaneId } from '../../core/domUtils';
import { globalState } from '../../core/pluginGlobalState';
import {
  readLastActivePanesFromStorage,
  readPanesOrderFromStorage,
  writeLastActiveToStorage,
  writePanesOrderToStorage,
} from '../../core/storage';
import { debounce } from '../../core/utils';
import { getCurrentSidebarPanes } from './paneCache';

// Resolves every pane's final id (cached -> DOM uuid -> plugin API -> title
// fallback) before writing, so the stored panes order uses uuid keys
// whenever one exists. Callers treat it as fire-and-forget.
export const updatePanesOrderInStorage = async (
  currentSidebarPanes?: Element[]
): Promise<void> => {
  const currentPanes = currentSidebarPanes || getCurrentSidebarPanes();
  const newPanesOrder = await Promise.all(
    currentPanes.map(pane => getResolvedPaneId(pane))
  );
  if (!Array.isArray(newPanesOrder)) return;
  writePanesOrderToStorage(newPanesOrder);
};

export const getInitialPanesOrder = (): string[] => readPanesOrderFromStorage();

let lastActivePanesCache: string[] | null = null;

// Resolves every open pane's final id before merging into the cache, so
// last-active entries are keyed the same way cleanup will query them.
export const getLastActivePanes = async (): Promise<string[]> => {
  if (lastActivePanesCache === null) {
    lastActivePanesCache = readLastActivePanesFromStorage();

    const currentPaneIds = (
      await Promise.all(getCurrentSidebarPanes().map(pane => getResolvedPaneId(pane)))
    ).filter(Boolean) as string[];
    const missingIds = currentPaneIds.filter(id => !lastActivePanesCache.includes(id));
    if (missingIds.length > 0) {
      lastActivePanesCache = missingIds.concat(lastActivePanesCache);
    }
  }

  return lastActivePanesCache;
};

// Stores the pane's final id (cached -> DOM uuid -> plugin API -> title
// fallback) so the cache entry uses the same key that
// cleanUnusedPanes/enforceMaxTabsLimit will query.
export const addToLastActivePanes = async (
  activePaneIndex?: number,
  currentSidebarPanes?: Element[]
): Promise<void> => {
  const paneIndex = activePaneIndex ?? globalState.currentActivePaneIndex;
  if (paneIndex === null) return;

  const currentPane = currentSidebarPanes?.[paneIndex];
  if (!currentPane) return;

  const currentPaneId = await getResolvedPaneId(currentPane);
  if (!currentPaneId) return;

  const current = await getLastActivePanes();

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
