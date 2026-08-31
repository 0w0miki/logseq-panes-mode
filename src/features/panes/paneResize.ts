import { APP_SETTINGS_CONFIG } from '../../core/constants';
import { getPaneIdFromPane, getHeaderPaneTitle } from '../../core/domUtils';
import { debugLog } from '../../core/logger';
import { globalState } from '../../core/pluginGlobalState';
import {
  PaneDimensions,
  readPanesDimensionsFromStorage,
  writePaneDimensionsToStorage,
} from '../../core/storage';
import { debounce } from '../../core/utils';
import type { PaneElement } from './types';
import {
  addScrollListenerToPane,
  disableFitContentForPane,
  observePaneCollapseState,
} from './paneLayout';
import { updateMultiColumnForPane } from './paneMultiColumn';

export const createPaneResizeObserver = (): ResizeObserver => {

  return new ResizeObserver(entries => handleResize(entries));
};

export const observePaneForResize = (resizeObserver: ResizeObserver, pane: Element): void => {
  if (!pane) return;
  observePaneCollapseState(pane);
  const paneElement = pane as PaneElement;
  if (paneElement._isResizeObserved) return;
  resizeObserver.observe(pane);
  paneElement._isResizeObserved = true;
  addScrollListenerToPane(pane);
  updateMultiColumnForPane(pane);
};

export const addPanesResizeObserver = (resizeObserver: ResizeObserver, panes: Element[]): void =>
  panes.forEach(pane => observePaneForResize(resizeObserver, pane));

const pendingResizeSaves = new Map<string, PaneDimensions>();

const FIT_CONTENT_HEIGHT_CHANGE_THRESHOLD_PX = 2;

const pendingMultiColumnUpdates = new Set<HTMLElement>();
let multiColumnRAF: number | null = null;

const flushMultiColumnUpdates = () => {
  if (multiColumnRAF) return;
  multiColumnRAF = requestAnimationFrame(() => {
    multiColumnRAF = null;
    pendingMultiColumnUpdates.forEach(pane => updateMultiColumnForPane(pane));
    pendingMultiColumnUpdates.clear();
  });
};

const queueMultiColumnUpdate = (pane: HTMLElement) => {
  pendingMultiColumnUpdates.add(pane);
  flushMultiColumnUpdates();
};

const flushPendingResizeSaves = debounce(() => {
  pendingResizeSaves.forEach((dimensions, pageId) => {
    writePaneDimensionsToStorage(pageId, dimensions);
  });
  pendingResizeSaves.clear();
}, APP_SETTINGS_CONFIG.resizeStoreDebounceMs);

const queueSizeForTitle = (pane: HTMLElement, dimensions: PaneDimensions): void => {
  // When a page pane is not completely loaded, it will write size with title.
  // But after that, it always write size with UUID. After Logseq restart,
  // the size with UUID may lost when opening the page pane.
  const title = getHeaderPaneTitle(pane);
  if (!title) return;
  pendingResizeSaves.set(title, dimensions);
};

const queuePaneResizeSave = (pane: HTMLElement, entry: ResizeObserverEntry): void => {
  const pageId = getPaneIdFromPane(pane);
  if (!pageId) return;
  const borderBox = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize;
  const width = Math.round(borderBox?.inlineSize ?? entry.target.getBoundingClientRect().width);
  const height = Math.round(borderBox?.blockSize ?? entry.target.getBoundingClientRect().height);
  if (width === 0 || height === 0) return;
  pendingResizeSaves.set(pageId, { width, height });
  queueSizeForTitle(pane, { width, height });
  flushPendingResizeSaves();
};

const queuePaneWidthSave = (pane: HTMLElement, entry: ResizeObserverEntry): void => {
  const pageId = getPaneIdFromPane(pane);
  if (!pageId) return;
  const borderBox = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize;
  const width = Math.round(borderBox?.inlineSize ?? entry.target.getBoundingClientRect().width);
  if (width === 0) return;

  const stored = readPanesDimensionsFromStorage();
  const storedDimensions = stored?.[pageId];
  if (
    storedDimensions?.width === width &&
    typeof storedDimensions?.height !== 'number' &&
    !pendingResizeSaves.has(pageId)
  ) {

    return;
  }

  pendingResizeSaves.set(pageId, { width });
  queueSizeForTitle(pane, { width });
  flushPendingResizeSaves();
};

const handleResize = (entries: ResizeObserverEntry[]) => {
  if (!globalState.isPanesModeModeActive) return;
  const isBatchResize = entries.length > 1;
  entries.forEach(entry => {
    const pane = entry.target as PaneElement;
    if (pane.id === 'right-sidebar-container') return;
    queueMultiColumnUpdate(pane);
    if (pane.classList.contains('collapsed')) return;

    const borderBox = Array.isArray(entry.borderBoxSize)
      ? entry.borderBoxSize[0]
      : entry.borderBoxSize;
    const height = Math.round(borderBox?.blockSize ?? entry.target.getBoundingClientRect().height);

    debugLog('[PanesMode] handleResize ', {
      fitContent: pane._fitContentActive,
      styleHeight: pane.style.height,
      height: height,
    });

    if (pane._fitContentActive && pane._fitContentBaselineHeightPx === undefined) {
      pane._fitContentBaselineHeightPx = height;
      debugLog(`[PanesMode] set fit content baseline height to ${pane._fitContentBaselineHeightPx}`)
      if (!isBatchResize) queuePaneWidthSave(pane, entry);
      return;
    }

    if (isBatchResize) return;

    if (!pane._fitContentActive) {
      queuePaneResizeSave(pane, entry);
      return;
    }

    // Fit content
    const baseline = pane._fitContentBaselineHeightPx ?? height;
    const heightDiff = Math.abs(height - baseline);

    if (heightDiff >= FIT_CONTENT_HEIGHT_CHANGE_THRESHOLD_PX) {
      disableFitContentForPane(pane, { restoreStoredDimensions: false });
      queuePaneResizeSave(pane, entry);
    } else {
      pane.style.height = 'auto';
      queuePaneWidthSave(pane, entry);
    }
  });
};
