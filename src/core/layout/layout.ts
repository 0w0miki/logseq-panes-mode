import { PLUGIN_UI_SELECTORS } from '../constants';
import { PluginSettings, getPluginSettings } from '../pluginSettings';
import {
  getLeftContainer,
  getLeftSidebar,
  getMainContent,
  getRightSidebar,
} from '../domUtils';
import { globalState } from '../pluginGlobalState';
import { debugWarn } from '../logger';
import layoutStyles from './layout.scss';
import tabsStyles from '../../features/tabs/tabs.scss';
import paneSwitcherStyles from '../../features/panes/paneSwitcher/paneSwitcher.scss';
import projectsStyles from '../../features/projects/projects.scss';
import toolbarStyles from '../../features/toolbar/toolbar.scss';
import type { LeftLayoutElements, ResizeState } from './layout.types';

let sidebarResizeCleanup: (() => void) | null = null;
export const RIGHT_WINDOW_CONTROLS_CLASS = 'panesMode-native-right-window-controls';

const panesModeBaseStyles = [tabsStyles, paneSwitcherStyles, projectsStyles, toolbarStyles].join(
  '\n'
);
const panesModeStyles = [
  layoutStyles,
  tabsStyles,
  paneSwitcherStyles,
  projectsStyles,
  toolbarStyles,
].join('\n');

// --- Styles ---

const buildDynamicStyles = (settings: PluginSettings): string => {
  const tabTextWidthPx = Math.max(settings.tabWidthPx * 0.75, settings.tabWidthPx - 20);
  const tabTextWidthHoverPx = Math.max(tabTextWidthPx - 13, settings.tabWidthPx * 0.55);
  const baseTabHeightPx = settings.tabHeightPx;
  const tabCloseSizePx = 16;
  const tabCloseOffsetTopPx = Math.max(Math.round((baseTabHeightPx - tabCloseSizePx) / 2), 0);
  const tabContainerHorizontalHeightPx = baseTabHeightPx;
  const tabsVerticalWidthPx = settings.tabWidthPx;
  const resizerWidthPx = settings.resizerWidthPx;
  const paneDefaultWidthPx = Math.max(100, settings.paneInitialWidthPx || 1000);
  const sidebarGapPx = Math.max(0, settings.panesGapPx ?? 10);
  const lightColors = {
    tabBg: settings.isVerticalTabs
      ? settings.themeLightTabBackground
      : settings.themeLightTabBackgroundHorizontal,
    tabActiveBg: settings.themeLightTabActiveBackground,
    tabText: settings.themeLightTabText,
  };
  const darkColors = {
    tabBg: settings.themeDarkTabBackground,
    tabActiveBg: settings.themeDarkTabActiveBackground,
    tabText: settings.themeDarkTabText,
  };
  const stickyHeadersStyles = settings.stickyPaneHeaders
    ? `
    body.panesMode-active .sidebar-item.content > div > div:first-of-type {
      position: sticky;
      top: 0rem;
      z-index: 100;
    }
  `
    : '';

  return `
    body.panesMode-active {
      --panesMode-tab-bg: ${lightColors.tabBg};
      --panesMode-tab-active-bg: ${lightColors.tabActiveBg};
      --panesMode-tab-text: ${lightColors.tabText};
      --panesMode-tab-width: ${settings.tabWidthPx}px;
      --panesMode-tab-height: ${baseTabHeightPx}px;
      --panesMode-tab-text-size: ${settings.tabTextSizePx}px;
      --panesMode-header-text-size: ${settings.headerTextSizePx}px;
      --panesMode-vertical-tabs-bg: ${settings.verticalTabsBackground};
      --panesMode-sidebar-list-bg: ${settings.sidebarListBackground};
      --panesMode-sidebar-list-bg-dark: ${settings.sidebarListBackgroundDark};
      --panesMode-resizer-color: ${settings.resizerColor};
      --panesMode-active-pane-border-width: ${settings.activePaneOutlineWidthPx}px;
      --panesMode-active-pane-border-color: ${settings.activePaneOutlineColor};
      --panesMode-pane-border-color: ${settings.paneBorderColor};
      --panesMode-pane-width: ${paneDefaultWidthPx}px;
    }
    html[data-theme='dark'] body.panesMode-active,
    body.panesMode-active[data-theme='dark'] {
      --panesMode-tab-bg: ${darkColors.tabBg};
      --panesMode-tab-active-bg: ${darkColors.tabActiveBg};
      --panesMode-tab-text: ${darkColors.tabText};
      --panesMode-active-pane-border-color: ${settings.activePaneOutlineColorDark};
      --panesMode-pane-border-color: ${settings.paneBorderColorDark};
      --panesMode-pane-switcher-item-bg-dark: ${settings.themeDarkPaneSwitcherItemBackground};
      --panesMode-pane-switcher-item-border-bottom-dark: ${settings.themeDarkPaneSwitcherItemBorderBottom};
      --panesMode-pane-switcher-item-selected-bg-dark: ${settings.themeDarkPaneSwitcherSelectedBackground};
      --panesMode-pane-switcher-item-selected-border-left-dark: ${settings.themeDarkPaneSwitcherSelectedBorderLeft};
    }

    body.panesMode-active .panesMode-tabs-container-horizontal {
      height: ${tabContainerHorizontalHeightPx}px;
    }

    body.panesMode-active .panesMode-tabs-container-vertical {
      width: ${tabsVerticalWidthPx}px;
    }

    body.panesMode-active .panesMode-tab .panesMode-tab-text {
      width: ${tabTextWidthPx}px;
    }

    body.panesMode-active .panesMode-tab:hover .panesMode-tab-text {
      width: ${tabTextWidthHoverPx}px;
    }

    body.panesMode-active .panesMode-tab-close {
      top: ${tabCloseOffsetTopPx}px;
    }

    body.panesMode-active .right-sidebar-vertical-tabs .cp__right-sidebar-scrollable {
      margin-left: ${tabsVerticalWidthPx}px;
    }

    body.panesMode-active .cp__right-sidebar .sidebar-item {
      width: ${paneDefaultWidthPx}px;
    }

    body.panesMode-active .sidebar-item-list {
      gap: ${sidebarGapPx}px;
    }

    body.panesMode-active .cp__right-sidebar .resizer {
      width: ${resizerWidthPx}px;
    }

    ${stickyHeadersStyles}
  `;
};

export const applyPanesModeStyles = (includeLayoutStyles = true): void => {
  const settings = getPluginSettings();
  const dynamicStyles = buildDynamicStyles(settings);
  const baseStyles = includeLayoutStyles ? panesModeStyles : panesModeBaseStyles;

  logseq.provideStyle({
    key: PLUGIN_UI_SELECTORS.customStylesKey,
    style: `${baseStyles}\n${dynamicStyles}`,
  });
};

export const clearInjectedStyles = (): void => {
  logseq.provideStyle({ key: PLUGIN_UI_SELECTORS.customStylesKey, style: '' });
};

export const syncNativeRightWindowControlsClass = (isMainContentHidden: boolean): void => {
  parent.document.body.classList.toggle(
    RIGHT_WINDOW_CONTROLS_CLASS,
    globalState.isPanesModeModeActive &&
      (globalState.isWindows || globalState.isLinux) &&
      isMainContentHidden
  );
};

// --- Left side layout ---
const getLeftSidebarWidthValue = (): number => {
  const computedStyle = getComputedStyle(parent.document.documentElement);

  return parseInt(computedStyle.getPropertyValue('--ls-left-sidebar-width'), 10);
};

const getLeftLayoutElements = (): LeftLayoutElements => {
  return {
    leftContainer: getLeftContainer(),
    mainContent: getMainContent(),
    leftSidebar: getLeftSidebar(),
    rightSidebar: getRightSidebar(),
  };
};

const applyMainContentHidden = (
  rightSidebar: HTMLElement,
  mainContent: HTMLElement | null,
  isLeftSideBarOpen: boolean
): void => {
  const rightSideClassToAdd = isLeftSideBarOpen ? 'panes-sidebar-dual' : 'panes-sidebar-full';
  rightSidebar.classList.add(rightSideClassToAdd);

  if (mainContent) {
    mainContent.style.display = 'none';
  }
};

const applyMainContentVisible = (
  rightSidebar: HTMLElement | null,
  mainContent: HTMLElement | null,
): void => {
  rightSidebar?.classList.remove('panes-sidebar-dual', 'panes-sidebar-full');

  // Ensure there is enough room for main content
  const windowWidth = parent.window.innerWidth;
  const newWidth = parseFloat(rightSidebar.style.width) / 100 * windowWidth;
  const leftSidebarWidth = getLeftSidebarWidthValue();
  if (leftSidebarWidth + newWidth > windowWidth) {
    rightSidebar.style.width = `${(newWidth - 100) / windowWidth * 100}%`;
  }

  if (mainContent) {
    mainContent.style.display = 'flex';
  }
};

export const hideMainContent = (): void => {
  const { leftContainer, mainContent, leftSidebar, rightSidebar } = getLeftLayoutElements();
  const isMainContentHidden = mainContent?.style.display === 'none';
  if (!leftContainer || isMainContentHidden || !rightSidebar) return;

  const isLeftSideBarOpen = leftSidebar?.classList.contains('is-open') ?? false;
  applyMainContentHidden(rightSidebar, mainContent, isLeftSideBarOpen);
  syncNativeRightWindowControlsClass(true);
  manageActionButtonsPosition();
};

export const showMainContent = (): void => {
  const { leftContainer, mainContent, rightSidebar } = getLeftLayoutElements();
  const mainContentVisible = mainContent?.style.display !== 'none';
  if (!leftContainer || mainContentVisible) return;

  applyMainContentVisible(rightSidebar, mainContent);
  syncNativeRightWindowControlsClass(false);
  manageActionButtonsPosition();
};

export const toggleMainContent = (): void => {
  const { mainContent, rightSidebar } = getLeftLayoutElements();
  const isHidden = mainContent?.style.display === 'none';
  if (!isHidden || !rightSidebar) {
    hideMainContent();
  } else {
    showMainContent();
  }
};

// --- Action buttons placement ---

const getHeaderButtons = (): {
  actionButtons: HTMLElement | null;
  leftHeaderButtons: HTMLElement | null;
} => {
  const actionButtons = parent.document.querySelector<HTMLElement>('.r.flex');
  const leftHeaderButtons = parent.document.querySelector<HTMLElement>('.l.flex');

  return { actionButtons, leftHeaderButtons };
};

const getOrCreateButtonsWrapper = (container: HTMLElement, className: string): HTMLElement => {
  const existing = container.querySelector(`.${className}`);

  if (existing) {
    return existing as HTMLElement;
  }

  const wrapper = parent.document.createElement('div');
  wrapper.className = className;
  container.appendChild(wrapper);

  return wrapper;
};

const placeButtonsInMainHeader = (): void => {
  const areButtonsAtPlace = parent.document.querySelector('#head > .r');
  if (areButtonsAtPlace) return;

  const { actionButtons, leftHeaderButtons } = getHeaderButtons();
  const mainContentHeader = parent.document.querySelector('#head');
  if (!mainContentHeader || !actionButtons || !leftHeaderButtons) return;

  mainContentHeader.appendChild(leftHeaderButtons);
  mainContentHeader.appendChild(actionButtons);
};

const placeButtonsInTabsContainer = (): void => {
  const wrapperClassName = 'action-buttons-wrapper';
  const areButtonsAtPlace = parent.document.querySelector(`.${wrapperClassName} > .r.flex`);
  if (areButtonsAtPlace) return;

  const { actionButtons, leftHeaderButtons } = getHeaderButtons();
  const appContainer = parent.document.querySelector('#app-container');
  if (!appContainer || !actionButtons || !leftHeaderButtons) return;

  const buttonsWrapper = getOrCreateButtonsWrapper(appContainer as HTMLElement, wrapperClassName);
  buttonsWrapper.appendChild(actionButtons);
  buttonsWrapper.appendChild(leftHeaderButtons);
};

export const restoreActionButtonsToHeader = (): void => {
  placeButtonsInMainHeader();
};

export const manageActionButtonsPosition = (): void => {
  const mainContent = getMainContent();
  const isMainContentHidden = mainContent?.style.display === 'none' || false;

  if (!isMainContentHidden) {
    placeButtonsInMainHeader();
    return;
  }

  placeButtonsInTabsContainer();
};

// --- Sidebar resize ---

const createResizeState = (): ResizeState => ({
  isDragging: false,
  startX: 0,
  startWidth: 0,
  resizeRAF: null,
  pendingClientX: null,
});

const cancelResizeFrame = (state: ResizeState): void => {
  if (!state.resizeRAF) return;
  cancelAnimationFrame(state.resizeRAF);
  state.resizeRAF = null;
};

const readSidebarWidth = (rightSidebar: HTMLElement): number => {
  const currentWidthStyle = rightSidebar.style.width;
  const windowWidth = parent.window.innerWidth;

  if (currentWidthStyle.includes('%')) {
    return (parseFloat(currentWidthStyle) / 100) * windowWidth;
  }

  if (currentWidthStyle.includes('px')) {
    return parseFloat(currentWidthStyle);
  }

  return rightSidebar.offsetWidth;
};

const clampSidebarWidth = (width: number, windowWidth: number): number => {
  const minWidth = 100;
  const leftSidebar = getLeftSidebar();
  const isLeftSideBarOpen = leftSidebar?.classList.contains('is-open') || false;

  let maxWidth = windowWidth - 50;
  if (isLeftSideBarOpen) {
    maxWidth = windowWidth - getLeftSidebarWidthValue() - 50;
  }

  return Math.max(minWidth, Math.min(maxWidth, width));
};

const scheduleResizeUpdate = (
  state: ResizeState,
  rightSidebar: HTMLElement,
  separator: HTMLElement
): void => {
  if (state.resizeRAF) return;

  state.resizeRAF = requestAnimationFrame(() => {
    state.resizeRAF = null;
    if (state.pendingClientX === null) return;

    const deltaX = state.startX - state.pendingClientX;
    const newWidth = state.startWidth + deltaX;
    const windowWidth = parent.window.innerWidth;
    const clampedWidth = clampSidebarWidth(newWidth, windowWidth);

    const widthPercentage = (clampedWidth / windowWidth) * 100;
    rightSidebar.style.width = `${widthPercentage}%`;
    separator.setAttribute('aria-valuenow', widthPercentage.toFixed(2));
  });
};

export const setupCustomSidebarResize = (): (() => void) => {
  const rightSidebar = getRightSidebar();
  const separator = rightSidebar?.querySelector('.resizer[role="separator"]') as HTMLElement | null;

  if (!separator || !rightSidebar) {
    debugWarn('[PanesMode] Could not find sidebar separator for custom resize');

    return () => {};
  }

  const resizeState = createResizeState();

  const stopDragging = () => {
    if (!resizeState.isDragging) return;

    resizeState.isDragging = false;
    resizeState.pendingClientX = null;

    cancelResizeFrame(resizeState);
  };

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    resizeState.isDragging = true;
    resizeState.startX = e.clientX;
    resizeState.startWidth = readSidebarWidth(rightSidebar);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!resizeState.isDragging) return;
    if (e.buttons === 0) {
      stopDragging();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    resizeState.pendingClientX = e.clientX;
    scheduleResizeUpdate(resizeState, rightSidebar, separator);
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!resizeState.isDragging) return;

    e.preventDefault();
    e.stopPropagation();
    stopDragging();
  };

  separator.addEventListener('mousedown', handleMouseDown, true);
  parent.document.addEventListener('mousemove', handleMouseMove, true);
  parent.document.addEventListener('mouseup', handleMouseUp, true);
  parent.window.addEventListener('blur', stopDragging, true);

  return () => {
    separator.removeEventListener('mousedown', handleMouseDown, true);
    parent.document.removeEventListener('mousemove', handleMouseMove, true);
    parent.document.removeEventListener('mouseup', handleMouseUp, true);
    parent.window.removeEventListener('blur', stopDragging, true);
    stopDragging();
  };
};

export const initCustomSidebarResize = (): void => {
  cleanupCustomSidebarResize();
  sidebarResizeCleanup = setupCustomSidebarResize();
};

export const cleanupCustomSidebarResize = (): void => {
  if (sidebarResizeCleanup) {
    sidebarResizeCleanup();
    sidebarResizeCleanup = null;
  }
};
