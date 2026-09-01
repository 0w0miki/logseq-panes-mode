import '@logseq/libs';
import { APP_SETTINGS_CONFIG } from './core/constants';
import {
  applyPanesModeStyles,
  clearInjectedStyles,
  hideMainContent,
  showMainContent,
  toggleMainContent,
  manageActionButtonsPosition,
  restoreActionButtonsToHeader,
  initCustomSidebarResize,
  cleanupCustomSidebarResize,
  RIGHT_WINDOW_CONTROLS_CLASS,
  syncNativeRightWindowControlsClass,
} from './core/layout/layout';
import { globalState, resetState } from './core/pluginGlobalState';
import {
  initPluginSettings,
  onSettingsUpdated,
  resetSettingsToDefaults,
} from './core/pluginSettings';
import { debugError, debugInfo } from './core/logger';
import { showSuccess } from './core/utils';
import { applyInitialPanesOrder } from './features/panes/paneOrdering';
import {
  applyInitialPaneSizes,
  addScrollListenersToAllPanes,
  resetPaneCollapse,
  cleanupPaneToggles,
  removeScrollListenerFromPane,
} from './features/panes/paneLayout';
import type { PaneElement } from './features/panes/types';
import { getCurrentSidebarPanes, refreshPanesElementsCache } from './features/panes/paneCache';
import { createPaneResizeObserver, addPanesResizeObserver } from './features/panes/paneResize';
import {
  createPanesMutationObserver,
  startPanesMutationObserver,
  stopContainerWatchdog,
} from './features/observers/paneMutations';
import { setupShiftClickPaneTracking } from './features/panes/shiftActions/paneShiftClick';
import { setActivePaneByIndex, resetActiveTabIndex } from './features/panes/paneNavigation';
import { setupKeyboardShortcuts } from './features/keyboard/keyboard';
import { setupMousePaneFocus } from './features/panes/paneFocusListeners';
import {
  resetPaneDropZones,
  setupNativeDragDropListener,
} from './features/panes/paneNativeDnd';
import { createTabsContainer, resetTabsState, updateTabs } from './features/tabs/tabs';
import {
  cleanupPaneSwitcher,
  initPaneSwitcherModal,
} from './features/panes/paneSwitcher/paneSwitcher';
import { cleanupProjects, initProjectsModal } from './features/projects/projects';
import { cleanUnusedPanes } from './features/panes/paneActions';
import { initLeftSidebarObserver } from './features/observers/leftSidebarObserver';
import {
  getMainContent,
  getPaneIdToElementMap,
  getRightSidebar,
  getRightSidebarContainer,
  getTabsContainer,
  isRightSidebarVisible,
} from './core/domUtils';
import { resetMultiColumnLayout } from './features/panes/paneMultiColumn';
import { registerToolbarUIItems } from './features/toolbar/toolbar';

let cleanupAutoPaneFocus: (() => void) | null = null;
let cleanupNativeDragDropListener: (() => void) | null = null;
let cleanupShiftClickTracking: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let panesContainerMutationsObserver: MutationObserver | null = null;
let leftSidebarObserver: MutationObserver | null = null;
let pendingPanesModeModeSetupInterval: ReturnType<typeof setInterval> | null = null;
let reactivateAfterRightSidebarShown = false;

const detectDBVersion = async (): Promise<void> => {
  try {
    const isDb = await (logseq.App as any).checkCurrentIsDbGraph();
    APP_SETTINGS_CONFIG.isDBVersion = isDb;
    debugInfo(`Logseq graph type detected: ${isDb ? 'DB' : 'file'}`);
  } catch {
    APP_SETTINGS_CONFIG.isDBVersion = false;
    debugInfo('Could not detect graph type, defaulting to file mode');
  }
};

const main = async () => {
  await initPluginSettings();
  await detectDBVersion();

  applyPanesModeStyles(false);

  await setupKeyboardShortcuts(togglePanesModeModeState);

  const resetSettings = createResetSettingsHandler();

  registerCommandPaletteItems(resetSettings);
  registerSettingsListeners();
  registerToolbarUIItems();
  registerAppEventHandlers();
  registerModelHandlers(resetSettings);
  registerBeforeUnload();

  debugInfo('PanesMode plugin fully loaded and ready.');
};

const createResetSettingsHandler = () => {
  return async () => {
    const wasActive = globalState.isPanesModeModeActive;

    await resetSettingsToDefaults();
    await setupKeyboardShortcuts(togglePanesModeModeState);

    if (wasActive) {
      applyPanesModeStyles();
    }

    showSuccess('PanesMode settings reset to defaults');
  };
};

const registerSettingsListeners = () => {
  onSettingsUpdated((settings, previous) => {
    setupKeyboardShortcuts(togglePanesModeModeState);
    if (globalState.isPanesModeModeActive) {
      applyPanesModeStyles(true);
      if (previous?.isVerticalTabs !== settings.isVerticalTabs) {
        rebuildTabsForOrientationChange();
      }
    }
  });
};

const registerAppEventHandlers = () => {
  logseq.App.onSidebarVisibleChanged(handleSidebarVisibilityChange);
  logseq.App.onThemeModeChanged(() => {
    const includeLayout = globalState.isPanesModeModeActive;
    applyPanesModeStyles(includeLayout);
  });
};

const registerModelHandlers = (resetSettings: () => Promise<void>) => {
  logseq.provideModel({
    async togglePanesModeMode() {
      await togglePanesModeModeState();
    },
    async resetPanesModeSettings() {
      await resetSettings();
    },
    async cleanUnusedPanes() {
      if (!globalState.isPanesModeModeActive) return;
      cleanUnusedPanes();
    },
    async hideMainContent() {
      if (!globalState.isPanesModeModeActive) return;
      hideMainContent();
    },
    async showMainContent() {
      if (!globalState.isPanesModeModeActive) return;
      showMainContent();
    },
    async toggleMainContent() {
      if (!globalState.isPanesModeModeActive) return;
      toggleMainContent();
    },
    async syncPanesOrder() {
      if (!globalState.isPanesModeModeActive) return;
      const currentPanes = getCurrentSidebarPanes();
      refreshPanesElementsCache(currentPanes);
      setActivePaneByIndex(0, currentPanes);
      updateTabs(currentPanes);
      showSuccess('Panes order synced');
    },
  });
};

const registerBeforeUnload = () => {
  logseq.beforeunload(async () => {
    if (globalState.isPanesModeModeActive) {
      cleanupPanesModeMode();
    }
    clearInjectedStyles();
  });
};

const registerCommandPaletteItems = (resetSettings: () => Promise<void>) => {
  logseq.App.registerCommandPalette(
    {
      key: 'panesMode.reset_settings',
      label: 'Reset PanesMode settings',
    },
    resetSettings
  );
};

const togglePanesModeModeState = async (forceState?: boolean): Promise<void> => {
  const shouldEnable = forceState ?? !globalState.isPanesModeModeActive;
  globalState.isPanesModeModeActive = shouldEnable;

  if (!shouldEnable) {
    disablePanesModeMode();

    return;
  }

  await enablePanesModeMode();
};

const enablePanesModeMode = async (): Promise<void> => {
  if (!isRightSidebarVisible()) {
    await logseq.App.setRightSidebarVisible(true);
  }

  schedulePanesModeModeSetup();
};

const disablePanesModeMode = () => {
  cleanupPanesModeMode();
  showSuccess('PanesMode Deactivated');
};

const handleSidebarVisibilityChange = ({ visible: newVisibilityState }: { visible: boolean }) => {
  if (globalState.isPanesModeModeActive && !newVisibilityState) {
    reactivateAfterRightSidebarShown = true;
    togglePanesModeModeState(false);
  }
  if (reactivateAfterRightSidebarShown && newVisibilityState) {
    reactivateAfterRightSidebarShown = false;
    togglePanesModeModeState(true);
  }
};

const clearPendingPanesModeModeSetup = () => {
  if (pendingPanesModeModeSetupInterval) {
    clearInterval(pendingPanesModeModeSetupInterval);
    pendingPanesModeModeSetupInterval = null;
  }
};

const schedulePanesModeModeSetup = () => {
  if (!globalState.isPanesModeModeActive || pendingPanesModeModeSetupInterval) return;

  pendingPanesModeModeSetupInterval = setInterval(() => {
    activatePanesModeMode();
  }, 100);
};

const activatePanesModeMode = async () => {
  if (!globalState.isPanesModeModeActive) return;

  const currentPanes = getCurrentSidebarPanes();
  if (currentPanes.length === 0) return;

  applyPanesModeModeUi();
  initializeTabsState();
  initializeModalsAndInputs();
  applyInitialPaneState(currentPanes);
  setupPaneObservers(currentPanes);

  showSuccess('PanesMode Activated!');
  clearPendingPanesModeModeSetup();
};

const applyPanesModeModeUi = () => {
  applyPanesModeStyles(true);

  parent.document.body.classList.add('panesMode-active');
  parent.document.body.classList.toggle('panesMode-db-version', APP_SETTINGS_CONFIG.isDBVersion);
  syncNativeRightWindowControlsClass(getMainContent()?.style.display === 'none');
};

const initializeTabsState = () => {
  createTabsContainer();
  refreshPanesElementsCache();
  setActivePaneByIndex(0);
  updateTabs();
};

const initializeModalsAndInputs = () => {
  initPaneSwitcherModal();
  // TODO: Check project modal agentic slop
  initProjectsModal();
  initCustomSidebarResize();

  cleanupAutoPaneFocus = setupMousePaneFocus();
  cleanupNativeDragDropListener = setupNativeDragDropListener();
  cleanupShiftClickTracking = setupShiftClickPaneTracking();
};

const applyInitialPaneState = (currentPanes: Element[]) => {
  const idToPaneMap = getPaneIdToElementMap(currentPanes);

  applyInitialPanesOrder(idToPaneMap, updateTabs, setActivePaneByIndex);
  applyInitialPaneSizes(idToPaneMap);
};

const setupPaneObservers = (currentPanes: Element[]) => {
  resizeObserver = createPaneResizeObserver();
  addPanesResizeObserver(resizeObserver, currentPanes);
  addScrollListenersToAllPanes();

  panesContainerMutationsObserver = createPanesMutationObserver(resizeObserver);
  startPanesMutationObserver(panesContainerMutationsObserver, resizeObserver);

  leftSidebarObserver = initLeftSidebarObserver();
};

const cleanupPanesModeMode = () => {
  clearPendingPanesModeModeSetup();
  debugInfo('Cleaning up PanesMode...');

  resetMultiColumnLayout();
  applyPanesModeStyles(false);

  resetBodyClasses();
  resetPanesState();
  cleanupObservers();
  resetSidebarLayout();
  cleanupTabsUi();
  cleanupFeatureUi();
  cleanupGlobalHandlers();

  resetState();
  debugInfo('PanesMode cleanup complete.');
};

const resetBodyClasses = () => {
  parent.document.body.classList.remove('panesMode-active');
  parent.document.body.classList.remove('panesMode-db-version');
  parent.document.body.classList.remove('panesMode-sticky-headers');
  parent.document.body.classList.remove(RIGHT_WINDOW_CONTROLS_CLASS);
};

const resetPanesState = () => {
  getCurrentSidebarPanes().forEach(pane => {
    const paneElement = pane as PaneElement;

    resetPaneCollapse(paneElement);
    resetPaneDropZones(paneElement);
    paneElement.classList.remove('selectedPane');

    delete paneElement._prevCollapsed;
    paneElement._fitContentActive = false;
    paneElement._fitContentBaselineHeightPx = undefined;
    paneElement._isResizeObserved = undefined;
    delete paneElement.dataset.currentIndex;

    cleanupPaneToggles(paneElement);

    removeScrollListenerFromPane(pane);
  });
};

const resetSidebarLayout = () => {
  const rightSidebar = getRightSidebar();
  const mainContent = getMainContent();

  if (mainContent?.style.display === 'none') {
    showMainContent();
  }

  rightSidebar?.classList.remove('panes-sidebar-full', 'panes-sidebar-dual');
  restoreActionButtonsToHeader();
};

const cleanupTabsUi = () => {
  const tabsContainer = getTabsContainer(APP_SETTINGS_CONFIG.isVerticalTabs);
  tabsContainer?.remove();

  const rightSideContainer = getRightSidebarContainer();
  rightSideContainer?.classList.remove('right-sidebar-vertical-tabs');

  resetTabsState();
  resetActiveTabIndex();
};

const cleanupFeatureUi = () => {
  cleanupPaneSwitcher();
  cleanupProjects();
  cleanupCustomSidebarResize();
};

const cleanupGlobalHandlers = () => {
  if (globalState.keyboardEventHandler) {
    parent.window.removeEventListener('keydown', globalState.keyboardEventHandler, true);
    globalState.keyboardEventHandler = null;
  }

  if (globalState.keyupEventHandler) {
    parent.window.removeEventListener('keyup', globalState.keyupEventHandler, true);
    globalState.keyupEventHandler = null;
  }

  if (cleanupAutoPaneFocus) {
    cleanupAutoPaneFocus();
    cleanupAutoPaneFocus = null;
  }

  if (cleanupShiftClickTracking) {
    cleanupShiftClickTracking();
    cleanupShiftClickTracking = null;
  }

  if (cleanupNativeDragDropListener) {
    cleanupNativeDragDropListener();
    cleanupNativeDragDropListener = null;
  }
};

const cleanupObservers = () => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  panesContainerMutationsObserver?.disconnect();
  panesContainerMutationsObserver = null;

  stopContainerWatchdog();

  leftSidebarObserver?.disconnect();
  leftSidebarObserver = null;
};

const rebuildTabsForOrientationChange = () => {
  const previousVerticalContainer = getTabsContainer(true);
  const previousHorizontalContainer = getTabsContainer(false);
  previousVerticalContainer?.remove();
  previousHorizontalContainer?.remove();

  const rightSideContainer = getRightSidebarContainer();
  rightSideContainer?.classList.toggle(
    'right-sidebar-vertical-tabs',
    APP_SETTINGS_CONFIG.isVerticalTabs
  );

  createTabsContainer();
  updateTabs(getCurrentSidebarPanes());
  manageActionButtonsPosition();
};

logseq.ready(main).catch(error => {
  debugError(error);
});
