// AI slop
import { APP_SETTINGS_CONFIG } from '../../../core/constants';
import {
  getPaneIdFromPane,
  getScrollablePanesContainer,
} from '../../../core/domUtils';
import { debugLog } from '../../../core/logger';
import { globalState, isActivePaneIndexValid } from '../../../core/pluginGlobalState';
import type { PendingShiftClick } from './types';
import { waitForDomChanges } from '../../../core/utils';
import { getCurrentSidebarPanes } from '../paneCache';
import { setActivePaneByIndex } from '../paneNavigation';
import { notifyVirtuosoScroll } from '../paneLayout';
import { updateTabs } from '../../tabs/tabs';
import { updatePanesOrderInStorage } from '../panePersistence';
import {
  startShiftClickPaneWatcher,
  stopShiftClickPaneWatcher,
} from '../../observers/paneMutations';
import {
  reorderPaneNextToActive,
  resolveActivePaneFromPending,
  resolveShiftClickTargetPane,
} from './paneShiftReorder';

const SHIFT_CLICK_SELECTORS = {
  page: '[data-ref]',
  block: '.bullet-container[blockid], .block-control[blockid], .block-ref[data-uuid]',
} as const;

const DB_SHIFT_CLICK_SELECTORS = {
  pageLink: 'a.page-ref[data-ref], a.tag[data-ref], .preview-ref-link a[data-ref]',
  pageContainer: '.preview-ref-link, .page-reference, .inline-wrap, .full.inline-wrap',
  pageId: '.ls-page-title .ls-block',
  pageTitle: '.ls-page-title-container .block-title-wrap',
} as const;

const DEBUG_PREFIX = '[PanesMode][ShiftClick]';

const SEARCH_HIGHLIGHTED_SPAN_SELECTOR = '.ui__list-item-highlighted-span, mark';
const SEARCH_SELECTED_ITEM_SELECTOR = [
  '[data-cmdk-item="true"][aria-selected="true"]',
  '[data-cmdk-item="true"][data-selected="true"]',
  '[cmdk-item][aria-selected="true"]',
  '[cmdk-item][data-selected="true"]',
  '[role="option"][aria-selected="true"]',
  '[aria-selected="true"]',
  '[data-selected="true"]',
  '[data-highlighted="true"]',
  '[data-highlighted]',
].join(', ');

const SEARCH_SECTION_LABELS = ['pages', 'blocks', 'recents'] as const;

const getSearchContainerSelector = (): string =>
  APP_SETTINGS_CONFIG.isDBVersion ? '.cp__cmdk__modal, .search-results' : '.search-results';

const getSearchItemSelector = (): string =>
  APP_SETTINGS_CONFIG.isDBVersion
    ? '[data-cmdk-item="true"], .transition-opacity'
    : '.transition-opacity';

type ShiftClickTarget = {
  type: PendingShiftClick['targetType'];
  id: string;
  candidates?: string[];
  searchSection?: PendingShiftClick['searchSection'];
};

type PendingSearchFocus = Pick<
  PendingShiftClick,
  'targetType' | 'targetId' | 'targetCandidates' | 'searchSection' | 'timestamp'
>;

type ActivePaneContext = Pick<PendingShiftClick, 'activePaneId' | 'activePaneIndex'>;

type SearchOpenActivePaneContext = ActivePaneContext & {
  timestamp: number;
};

const getSearchSectionLabel = (node: HTMLElement): string | null => {
  const text = node.textContent?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  const match = SEARCH_SECTION_LABELS.find(label => normalized.startsWith(label));

  return match ? text : null;
};

const getSearchSectionType = (
  item: HTMLElement,
  container: HTMLElement
): 'page' | 'block' | 'recent' | null => {
  if (item.querySelector('.breadcrumb, .block-parents')) {
    return 'block';
  }
  let current: HTMLElement | null = item;
  while (current && current !== container) {
    let sibling = current.previousElementSibling as HTMLElement | null;
    while (sibling) {
      const label = getSearchSectionLabel(sibling);
      if (label) {
        const normalized = label.toLowerCase();
        if (normalized.startsWith('blocks')) return 'block';
        if (normalized.startsWith('pages')) return 'page';
        if (normalized.startsWith('recents')) return 'recent';

        return null;
      }
      sibling = sibling.previousElementSibling as HTMLElement | null;
    }
    current = current.parentElement as HTMLElement | null;
  }

  return null;
};

const extractPageNameFromText = (text: string): string => {
  const bracketMatch = text.match(/\[\[([^\]]+)\]\]/);
  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1].trim();
  }

  return text;
};

const getSearchItemText = (item: HTMLElement): string => {
  const rawText = (item.innerText || item.textContent || '').trim();
  if (rawText) {
    const firstLine =
      rawText
        .split('\n')
        .map(line => line.trim())
        .find(Boolean) ?? '';
    if (firstLine) {
      return extractPageNameFromText(firstLine);
    }
  }
  const highlighted = Array.from(item.querySelectorAll(SEARCH_HIGHLIGHTED_SPAN_SELECTOR));
  if (highlighted.length > 0) {
    const joined = highlighted
      .map(el => el.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (joined) return joined;
  }

  return '';
};

const getSearchBlockText = (item: HTMLElement): string => {
  const breadcrumb = item.querySelector('.breadcrumb, .block-parents') as HTMLElement | null;
  const rawText = (item.innerText || item.textContent || '').trim();
  if (!rawText) return '';
  let sanitized = rawText;
  if (breadcrumb?.textContent) {
    sanitized = sanitized.replace(breadcrumb.textContent, '');
  }
  const lines = sanitized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const candidate = lines[lines.length - 1];
  if (candidate) return candidate;

  const highlights = Array.from(item.querySelectorAll(SEARCH_HIGHLIGHTED_SPAN_SELECTOR)).filter(
    span =>
      !span.closest('.breadcrumb') &&
      !span.closest('.block-parents') &&
      !span.closest('.page-ref') &&
      !span.closest('.ls-icon')
  );
  if (highlights.length > 0) {
    const joined = highlights
      .map(el => el.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (joined) return joined;
  }

  return '';
};
const findSearchContainer = (target?: HTMLElement | null): HTMLElement | null => {
  const containerSelector = getSearchContainerSelector();
  const direct = target?.closest(containerSelector) as HTMLElement | null;
  if (direct) return direct;
  const containers = Array.from(parent.document.querySelectorAll<HTMLElement>(containerSelector));

  return (
    containers.find(container => container.offsetParent !== null || container.offsetHeight > 0) ??
    null
  );
};

const isEnterKey = (event: KeyboardEvent): boolean =>
  event.key === 'Enter' ||
  event.key === 'NumpadEnter' ||
  event.code === 'Enter' ||
  event.code === 'NumpadEnter' ||
  event.key === 'Return';

const getSearchItems = (container: HTMLElement): { all: HTMLElement[]; leaf: HTMLElement[] } => {
  const itemSelector = getSearchItemSelector();
  const allItems = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  if (allItems.length === 0) return { all: [], leaf: [] };
  const itemsWithText = allItems.filter(item => (item.innerText || item.textContent || '').trim());
  const baseItems = itemsWithText.length > 0 ? itemsWithText : allItems;
  const leafItems = baseItems.filter(
    item => !baseItems.some(other => other !== item && item.contains(other))
  );

  return {
    all: baseItems,
    leaf: leafItems.length > 0 ? leafItems : baseItems,
  };
};

const findInlineOpacitySearchItem = (container?: HTMLElement | null): HTMLElement | null => {
  const containerSelector = getSearchContainerSelector();
  const itemSelector = getSearchItemSelector();
  const containers = container
    ? [container]
    : Array.from(parent.document.querySelectorAll<HTMLElement>(containerSelector));
  for (const searchContainer of containers) {
    const direct = searchContainer.querySelector<HTMLElement>(
      `${itemSelector}[style*="opacity: 1"], ${itemSelector}[style*="opacity:1"]`
    );
    if (direct) return direct;
    const inlineElement = searchContainer.querySelector<HTMLElement>(
      '[style*="opacity: 1"], [style*="opacity:1"]'
    );
    if (inlineElement) {
      const closestItem = inlineElement.closest(itemSelector) as HTMLElement | null;
      if (closestItem && searchContainer.contains(closestItem)) return closestItem;
    }
  }

  return null;
};

const findSearchItemForElement = (
  element: HTMLElement | null,
  container: HTMLElement,
  items: HTMLElement[]
): HTMLElement | null => {
  if (!element) return null;

  return items.find(item => item.contains(element)) ?? null;
};

const resolveSearchItemElement = (
  element: HTMLElement,
  container: HTMLElement,
  allItems: HTMLElement[],
  leafItems: HTMLElement[]
): HTMLElement | null => {
  const fromLeaf = findSearchItemForElement(element, container, leafItems);
  if (fromLeaf) return fromLeaf;

  const containingLeaf = leafItems.find(item => element.contains(item));
  if (containingLeaf) return containingLeaf;

  const fromAll = findSearchItemForElement(element, container, allItems);
  if (fromAll) return fromAll;

  const itemSelector = getSearchItemSelector();
  const closestItem = element.closest(itemSelector) as HTMLElement | null;
  if (!closestItem || !container.contains(closestItem)) return null;

  return (
    leafItems.find(item => closestItem.contains(item)) ??
    allItems.find(item => item === closestItem || item.contains(closestItem)) ??
    closestItem
  );
};

const findExplicitSelectedSearchItem = (
  container: HTMLElement,
  allItems: HTMLElement[],
  leafItems: HTMLElement[]
): HTMLElement | null => {
  const selectedElements = Array.from(
    container.querySelectorAll<HTMLElement>(SEARCH_SELECTED_ITEM_SELECTOR)
  );

  for (const selectedElement of selectedElements) {
    const item = resolveSearchItemElement(selectedElement, container, allItems, leafItems);
    if ((item?.innerText || item?.textContent || '').trim()) {
      return item;
    }
  }

  return null;
};

const getOpacityValue = (element: HTMLElement): number => {
  const opacity = parent.window.getComputedStyle(element).opacity;
  const value = parseFloat(opacity);

  return Number.isNaN(value) ? 0 : value;
};

const getSearchSelectedItem = (container: HTMLElement): HTMLElement | null => {
  const { all, leaf } = getSearchItems(container);
  if (leaf.length === 0) return null;

  const explicitSelected = findExplicitSelectedSearchItem(container, all, leaf);
  if (explicitSelected) {
    debugLog(DEBUG_PREFIX, 'search selection from selected attribute', {
      opacity: getOpacityValue(explicitSelected),
      sectionType: getSearchSectionType(explicitSelected, container),
    });

    return explicitSelected;
  }

  const inlineSelected = findInlineOpacitySearchItem(container) ?? findInlineOpacitySearchItem();
  if (inlineSelected) {
    const inlineContainer = findSearchContainer(inlineSelected) ?? container;
    const inlineItems =
      inlineContainer === container ? { all, leaf } : getSearchItems(inlineContainer);
    const resolvedInlineSelected =
      resolveSearchItemElement(
        inlineSelected,
        inlineContainer,
        inlineItems.all,
        inlineItems.leaf
      ) ?? inlineSelected;
    debugLog(DEBUG_PREFIX, 'search selection from inline opacity', {
      opacity: getOpacityValue(resolvedInlineSelected),
      sectionType: getSearchSectionType(resolvedInlineSelected, inlineContainer),
    });

    return resolvedInlineSelected;
  }

  const activeElement = parent.document.activeElement as HTMLElement | null;
  const fromActive = findSearchItemForElement(activeElement, container, leaf);
  if (fromActive) {
    debugLog(DEBUG_PREFIX, 'search selection from active element', {
      opacity: getOpacityValue(fromActive),
      sectionType: getSearchSectionType(fromActive, container),
    });

    return fromActive;
  }

  const classOpacityItem = all.find(item => item.classList.contains('opacity-100'));
  if (classOpacityItem) {
    const resolvedItem = leaf.find(item => classOpacityItem.contains(item)) ?? classOpacityItem;
    debugLog(DEBUG_PREFIX, 'search selection from opacity-100 class', {
      opacity: getOpacityValue(resolvedItem),
      sectionType: getSearchSectionType(resolvedItem, container),
    });

    return resolvedItem;
  }

  let maxOpacityItem = leaf[0];
  let maxOpacityValue = getOpacityValue(maxOpacityItem);
  leaf.slice(1).forEach(item => {
    const value = getOpacityValue(item);
    if (value > maxOpacityValue) {
      maxOpacityValue = value;
      maxOpacityItem = item;
    }
  });
  if (maxOpacityItem) {
    debugLog(DEBUG_PREFIX, 'search selection from max opacity', {
      opacity: maxOpacityValue,
      sectionType: getSearchSectionType(maxOpacityItem, container),
    });

    return maxOpacityItem;
  }

  const highlightedItems = Array.from(
    container.querySelectorAll<HTMLElement>(SEARCH_HIGHLIGHTED_SPAN_SELECTOR)
  )
    .map(span => findSearchItemForElement(span, container, leaf))
    .filter(Boolean) as HTMLElement[];
  const highlightedSelected = highlightedItems[0];
  if (highlightedSelected) {
    debugLog(DEBUG_PREFIX, 'search selection from highlights', {
      opacity: getOpacityValue(highlightedSelected),
      sectionType: getSearchSectionType(highlightedSelected, container),
    });

    return highlightedSelected;
  }

  debugLog(DEBUG_PREFIX, 'search selection fallback', {
    opacity: getOpacityValue(leaf[0]),
    sectionType: getSearchSectionType(leaf[0], container),
  });

  return leaf[0];
};

const findSearchItem = (target: HTMLElement, container: HTMLElement): HTMLElement | null => {
  const { leaf } = getSearchItems(container);
  const normalized = findSearchItemForElement(target, container, leaf);
  if (normalized) return normalized;

  if (container.contains(target) && target.querySelector(SEARCH_HIGHLIGHTED_SPAN_SELECTOR)) {
    return findSearchItemForElement(target, container, leaf);
  }

  const highlight = target.closest(SEARCH_HIGHLIGHTED_SPAN_SELECTOR) as HTMLElement | null;
  if (highlight) {
    const fromHighlight = findSearchItemForElement(highlight, container, leaf);
    if (fromHighlight) return fromHighlight;
  }

  return null;
};

const getSearchPaneTarget = (target: HTMLElement): ShiftClickTarget | null => {
  const container = findSearchContainer(target);
  if (!container) return null;
  const item = findSearchItem(target, container);
  if (!item) return null;
  const sectionType = getSearchSectionType(item, container);
  const preferPage = sectionType === 'page' || sectionType === 'recent';

  if (sectionType === 'block') {
    const blockText = getSearchBlockText(item);
    if (!blockText) return null;

    return {
      type: 'block',
      id: blockText,
      candidates: [blockText],
      searchSection: 'block',
    };
  }

  const text = getSearchItemText(item);
  if (!text) return null;

  return {
    type: 'page',
    id: text,
    candidates: [text],
    searchSection: preferPage ? (sectionType ?? 'page') : (sectionType ?? 'page'),
  };
};

const getPageCandidatesFromElement = (element: HTMLElement | null): string[] => {
  if (!element) return [];

  const candidates = new Set<string>();
  const addCandidate = (value: string | null | undefined) => {
    const trimmedValue = value?.trim();
    if (trimmedValue) {
      candidates.add(extractPageNameFromText(trimmedValue));
    }
  };

  addCandidate(element.getAttribute('data-ref'));
  addCandidate(element.getAttribute('data-page'));
  addCandidate(element.getAttribute('data-page-name'));
  addCandidate(element.textContent);

  return Array.from(candidates);
};

const getPageCandidatesFromTitle = (element: HTMLElement): string[] => {
  if (!element) return [];
  if (!element.matches(DB_SHIFT_CLICK_SELECTORS.pageTitle)) return [];

  const idElement = element.closest(DB_SHIFT_CLICK_SELECTORS.pageId) as HTMLElement | null;
  if (!idElement) return [];


  const candidates = new Set<string>();
  const addCandidate = (value: string | null | undefined) => {
    const trimmedValue = value?.trim();
    if (trimmedValue) {
      candidates.add(extractPageNameFromText(trimmedValue));
    }
  };

  addCandidate(idElement.getAttribute('blockid'));
  addCandidate(element.textContent);

  return Array.from(candidates);
}

const getDbPageTargetElement = (target: HTMLElement): HTMLElement | null => {
  const directPageLink = target.closest(DB_SHIFT_CLICK_SELECTORS.pageLink) as HTMLElement | null;
  if (directPageLink) return directPageLink;

  let currentElement: HTMLElement | null = target;
  while (currentElement && currentElement !== parent.document.body) {
    if (currentElement.matches(DB_SHIFT_CLICK_SELECTORS.pageContainer)) {
      const descendantPageLink = currentElement.querySelector(
        DB_SHIFT_CLICK_SELECTORS.pageLink
      ) as HTMLElement | null;
      if (descendantPageLink) return descendantPageLink;

      const siblingPageLink = currentElement.parentElement?.querySelector(
        DB_SHIFT_CLICK_SELECTORS.pageLink
      ) as HTMLElement | null;
      if (siblingPageLink) return siblingPageLink;
    }

    currentElement = currentElement.parentElement;
  }

  return null;
};

const getShiftClickTarget = (target: HTMLElement): ShiftClickTarget | null => {
  const searchTarget = getSearchPaneTarget(target);
  if (searchTarget) {
    debugLog(DEBUG_PREFIX, 'search target', searchTarget);

    return searchTarget;
  }

  // Page
  if (APP_SETTINGS_CONFIG.isDBVersion) {
    let pageCandidates = getPageCandidatesFromTitle(target);
    if (pageCandidates.length > 0) {
      debugLog(DEBUG_PREFIX, 'page target', pageCandidates[0]);
      return { type: 'page', id: pageCandidates[0], candidates: pageCandidates };
    }

    const dbPageElement = getDbPageTargetElement(target);
    pageCandidates = getPageCandidatesFromElement(dbPageElement);
    if (pageCandidates.length > 0) {
      return { type: 'page', id: pageCandidates[0], candidates: pageCandidates };
    }
  }

  const pageElement = target.closest(SHIFT_CLICK_SELECTORS.page) as HTMLElement | null;
  const pageCandidates = getPageCandidatesFromElement(pageElement);
  if (pageCandidates.length > 0) {
    return { type: 'page', id: pageCandidates[0], candidates: pageCandidates };
  }

  // Block
  const blockElement = target.closest(SHIFT_CLICK_SELECTORS.block) as HTMLElement | null;
  const blockId = blockElement?.getAttribute('blockid') ?? blockElement?.getAttribute('data-uuid');
  if (blockId) {
    debugLog(DEBUG_PREFIX, 'block target', blockId);

    return { type: 'block', id: blockId, candidates: [blockId] };
  }

  debugLog(DEBUG_PREFIX, 'no target match', {
    tag: target.tagName,
    className: target.className,
  });

  return null;
};

const getActivePaneContextFromState = (): Pick<
  PendingShiftClick,
  'activePaneId' | 'activePaneIndex'
> => {
  if (isActivePaneIndexValid()) {
    const activePaneIndex = globalState.currentActivePaneIndex as number;
    const activePane = globalState.cachedPanes[activePaneIndex];
    const activePaneId = activePane ? getPaneIdFromPane(activePane) : null;

    return { activePaneId, activePaneIndex };
  }

  const panes = getCurrentSidebarPanes();
  if (panes.length === 0) {
    return { activePaneId: null, activePaneIndex: null };
  }

  const selectedPane =
    panes.find(pane => (pane as HTMLElement).classList.contains('selectedPane')) ?? panes[0];
  const activePaneIndex = panes.indexOf(selectedPane);
  const activePaneId = getPaneIdFromPane(selectedPane);

  return {
    activePaneId,
    activePaneIndex: activePaneIndex >= 0 ? activePaneIndex : null,
  };
};

const getActivePaneContext = (
  target: HTMLElement
): Pick<PendingShiftClick, 'activePaneId' | 'activePaneIndex'> => {
  const panesContainer = getScrollablePanesContainer();
  const paneElement = target.closest('.sidebar-item') as HTMLElement | null;
  if (panesContainer && paneElement && panesContainer.contains(paneElement)) {
    const activePaneId = getPaneIdFromPane(paneElement);
    const indexValue = parseInt(paneElement.dataset.currentIndex ?? '-1', 10);
    const activePaneIndex = Number.isNaN(indexValue) ? null : indexValue;
    if (activePaneId || activePaneIndex !== null) {
      return { activePaneId: activePaneId ?? null, activePaneIndex };
    }
  }

  return getActivePaneContextFromState();
};

let pendingSearchFocusTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSearchFocusRetryTimer: ReturnType<typeof setTimeout> | null = null;
let searchOpenActivePaneContext: SearchOpenActivePaneContext | null = null;
const SHIFT_CLICK_FALLBACK_DELAY_MS = 0;
const SHIFT_CLICK_RETRY_DELAY_MS = 200;
const SEARCH_OPEN_CONTEXT_TTL_MS = 120_000;

const rememberSearchOpenActivePaneContext = (): void => {
  const activePaneContext = getActivePaneContextFromState();
  if (!activePaneContext.activePaneId && activePaneContext.activePaneIndex === null) return;
  searchOpenActivePaneContext = {
    ...activePaneContext,
    timestamp: Date.now(),
  };
};

const getSearchOpenActivePaneContext = (): ActivePaneContext | null => {
  if (!searchOpenActivePaneContext) return null;
  if (Date.now() - searchOpenActivePaneContext.timestamp > SEARCH_OPEN_CONTEXT_TTL_MS) {
    searchOpenActivePaneContext = null;

    return null;
  }

  return {
    activePaneId: searchOpenActivePaneContext.activePaneId,
    activePaneIndex: searchOpenActivePaneContext.activePaneIndex,
  };
};

const shouldRememberSearchOpenContext = (event: KeyboardEvent): boolean => {
  const key = event.key?.toLowerCase();
  if (key !== 'p' && key !== 'k') return false;
  if (!event.metaKey && !event.ctrlKey) return false;

  return !event.altKey && !event.shiftKey;
};

const createPendingSearchFocus = (target: ShiftClickTarget): PendingSearchFocus => ({
  targetType: target.type,
  targetId: target.id,
  targetCandidates: target.candidates ?? [target.id],
  searchSection: target.searchSection ?? null,
  timestamp: Date.now(),
});

const areCurrentPanesSynced = (panes: Element[]): boolean =>
  panes.length === globalState.cachedPanes.length &&
  panes.every((pane, index) => pane === globalState.cachedPanes[index]);

const getFocusedPaneFromDocument = (panes: Element[]): Element | null => {
  const activeElement = parent.document.activeElement as HTMLElement | null;
  if (!activeElement) return null;
  const paneElement = activeElement.closest('.sidebar-item') as HTMLElement | null;
  if (!paneElement) return null;

  return panes.find(pane => pane === paneElement) ?? null;
};

const focusPaneForSearchTarget = (pending: PendingSearchFocus): boolean => {
  const container = getScrollablePanesContainer();
  if (!container) return false;
  const currentPanes = getCurrentSidebarPanes(container);
  if (!areCurrentPanesSynced(currentPanes)) {
    debugLog(DEBUG_PREFIX, 'skip search focus while panes are mutating', {
      targetType: pending.targetType,
      targetId: pending.targetId,
      paneCount: currentPanes.length,
      cachedPaneCount: globalState.cachedPanes.length,
    });

    return false;
  }

  const targetPane =
    resolveShiftClickTargetPane(
      {
        ...pending,
        activePaneId: null,
        activePaneIndex: null,
      },
      currentPanes
    ) ?? getFocusedPaneFromDocument(currentPanes);
  if (!targetPane) {
    debugLog(DEBUG_PREFIX, 'search focus target pane not found', {
      targetType: pending.targetType,
      targetId: pending.targetId,
      targetCandidates: pending.targetCandidates,
      searchSection: pending.searchSection,
    });

    return false;
  }

  const targetIndex = currentPanes.indexOf(targetPane);
  if (targetIndex === -1) return false;

  debugLog(DEBUG_PREFIX, 'focus pane from search', {
    targetType: pending.targetType,
    targetId: pending.targetId,
    targetPaneId: getPaneIdFromPane(targetPane),
    targetIndex,
  });
  setActivePaneByIndex(targetIndex, currentPanes, true);

  return true;
};

const scheduleSearchPaneFocus = (pending: PendingSearchFocus): void => {
  if (pendingSearchFocusTimer) {
    clearTimeout(pendingSearchFocusTimer);
    pendingSearchFocusTimer = null;
  }
  if (pendingSearchFocusRetryTimer) {
    clearTimeout(pendingSearchFocusRetryTimer);
    pendingSearchFocusRetryTimer = null;
  }

  pendingSearchFocusTimer = waitForDomChanges(() => {
    const handled = focusPaneForSearchTarget(pending);
    if (handled) return;

    pendingSearchFocusRetryTimer = waitForDomChanges(() => {
      focusPaneForSearchTarget(pending);
    }, SHIFT_CLICK_RETRY_DELAY_MS / 1000).timeoutId;
  }, SHIFT_CLICK_FALLBACK_DELAY_MS / 1000).timeoutId;
};

export const setupShiftClickPaneTracking = (): (() => void) => {
  const getEventTargetElement = (event: Event): HTMLElement | null => {
    const rawTarget = event.target as Element | null;

    return rawTarget && rawTarget.nodeType === 1
      ? (rawTarget as HTMLElement)
      : (rawTarget?.parentElement ?? null);
  };

  const setPendingShiftClickFromTarget = (
    target: HTMLElement,
    shiftTarget: ShiftClickTarget,
    activePaneContext: ActivePaneContext = getActivePaneContext(target)
  ): void => {
    const pending: PendingShiftClick = {
      targetType: shiftTarget.type,
      targetId: shiftTarget.id,
      targetCandidates: shiftTarget.candidates ?? [shiftTarget.id],
      searchSection: shiftTarget.searchSection ?? null,
      timestamp: Date.now(),
      activePaneId: activePaneContext.activePaneId,
      activePaneIndex: activePaneContext.activePaneIndex,
    };
    debugLog(DEBUG_PREFIX, 'pending set', pending);

    // Target already open — reorder inline, no need for mutation observer
    const existingPane = resolveShiftClickTargetPane(pending, globalState.cachedPanes);
    if (existingPane && globalState.cachedPanes.includes(existingPane)) {
      debugLog(DEBUG_PREFIX, 'existing pane matched, reorder inline', {
        paneId: getPaneIdFromPane(existingPane),
        activePaneId: pending.activePaneId,
        activePaneIndex: pending.activePaneIndex,
      });
      const container = getScrollablePanesContainer();
      if (container) {
        const activePane = resolveActivePaneFromPending(pending, globalState.cachedPanes);
        const reordered = reorderPaneNextToActive(existingPane, activePane, container);
        if (reordered) {
          const idx = reordered.indexOf(existingPane);
          if (idx !== -1) setActivePaneByIndex(idx, reordered);
          updatePanesOrderInStorage(reordered);
          updateTabs(reordered);
          notifyVirtuosoScroll();
          debugLog(DEBUG_PREFIX, 'inline reorder done', { newIndex: idx });
        }
      }
      return;
    }

    globalState.pendingShiftClick = pending;
    startShiftClickPaneWatcher();
  };

  const handleClick = (event: MouseEvent) => {
    if (!globalState.isPanesModeModeActive) return;
    if (event.button !== 0) return;

    if (event.shiftKey) {
      const target = getEventTargetElement(event);
      if (!target) return;

      const shiftTarget = getShiftClickTarget(target);
      if (!shiftTarget) return;

      setPendingShiftClickFromTarget(target, shiftTarget);
      return;
    }

    const target = getEventTargetElement(event);
    if (!target) return;

    const searchTarget = getSearchPaneTarget(target);
    if (!searchTarget) return;

    const pendingSearchFocus = createPendingSearchFocus(searchTarget);
    debugLog(DEBUG_PREFIX, 'search click focus pending', pendingSearchFocus);
    scheduleSearchPaneFocus(pendingSearchFocus);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!globalState.isPanesModeModeActive) return;
    if (shouldRememberSearchOpenContext(event)) {
      rememberSearchOpenActivePaneContext();

      return;
    }
    if (event.key === 'Escape') {
      searchOpenActivePaneContext = null;

      return;
    }
    if (!isEnterKey(event)) return;

    const target = getEventTargetElement(event);
    const activeElement = parent.document.activeElement as HTMLElement | null;
    const container =
      findSearchContainer(target) ?? findSearchContainer(activeElement) ?? findSearchContainer();
    if (!container) {
      searchOpenActivePaneContext = null;

      return;
    }

    const selectedItem = getSearchSelectedItem(container);
    if (!selectedItem) return;

    const selectionContainer = findSearchContainer(selectedItem) ?? container;
    const sectionType = getSearchSectionType(selectedItem, selectionContainer);
    debugLog(DEBUG_PREFIX, 'search enter selection', {
      tag: selectedItem.tagName,
      className: selectedItem.className,
      sectionType,
      opacity: getOpacityValue(selectedItem),
      pageText: getSearchItemText(selectedItem),
      blockText: getSearchBlockText(selectedItem),
    });

    const searchTarget = getSearchPaneTarget(selectedItem);
    if (!searchTarget) return;

    if (!event.shiftKey) {
      const pendingSearchFocus = createPendingSearchFocus(searchTarget);
      debugLog(DEBUG_PREFIX, 'search enter focus pending', pendingSearchFocus);
      scheduleSearchPaneFocus(pendingSearchFocus);
      searchOpenActivePaneContext = null;

      return;
    }

    const activePaneContext =
      getSearchOpenActivePaneContext() ?? getActivePaneContext(selectedItem);
    setPendingShiftClickFromTarget(selectedItem, searchTarget, activePaneContext);
    debugLog(DEBUG_PREFIX, 'shift+enter pending set', globalState.pendingShiftClick);
    searchOpenActivePaneContext = null;
  };

  const targetWindow = parent.window ?? window;
  targetWindow.addEventListener('click', handleClick, true);
  targetWindow.addEventListener('keydown', handleKeyDown, true);
  debugLog(DEBUG_PREFIX, 'listeners attached to parent.window');

  return () => {
    targetWindow.removeEventListener('click', handleClick, true);
    targetWindow.removeEventListener('keydown', handleKeyDown, true);
    stopShiftClickPaneWatcher();
    if (pendingSearchFocusTimer) {
      clearTimeout(pendingSearchFocusTimer);
      pendingSearchFocusTimer = null;
    }
    if (pendingSearchFocusRetryTimer) {
      clearTimeout(pendingSearchFocusRetryTimer);
      pendingSearchFocusRetryTimer = null;
    }
    searchOpenActivePaneContext = null;
  };
};
