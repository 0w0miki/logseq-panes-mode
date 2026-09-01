import { getScrollablePanesContainer } from '../../core/domUtils';
import { debugError } from '../../core/logger';
import { globalState, isActivePaneIndexValid } from '../../core/pluginGlobalState';
import { setActivePaneByIndex } from './paneNavigation';

const PANE_FOCUS_SELECTORS = {
  paneItem: '.sidebar-item.content',
} as const;

export const setupMousePaneFocus = (): (() => void) => {
  const panesContainer = getScrollablePanesContainer();
  if (!panesContainer) {
    debugError('Could not find panes container for mousedown listener.');

    return () => {};
  }
  const documentMouseDownHandler = (e: MouseEvent) => {
    if (!globalState.isPanesModeModeActive) return;
    const target = e.target as HTMLElement;
    if (!target) return;
    if (!isActivePaneIndexValid()) return;
    const activePane = globalState.cachedPanes[globalState.currentActivePaneIndex];
    if (activePane && activePane.contains(target)) return;
    const clickedPaneElement = target.closest(PANE_FOCUS_SELECTORS.paneItem) as HTMLElement | null;
    if (!clickedPaneElement) return;
    const clickedIndexString = clickedPaneElement.dataset.currentIndex;
    const clickedIndex = parseInt(clickedIndexString ?? '-1', 10);
    if (Number.isNaN(clickedIndex)) return;
    setActivePaneByIndex(clickedIndex, globalState.cachedPanes, true);
  };
  panesContainer.addEventListener('mousedown', documentMouseDownHandler, {
    capture: true,
    passive: true,
  });

  return () => {
    panesContainer.removeEventListener('mousedown', documentMouseDownHandler, true);
  };
};
