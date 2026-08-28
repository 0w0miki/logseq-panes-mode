import '@logseq/libs';
import { APP_SETTINGS_CONFIG, LOGSEQ_UI_SELECTORS, PLUGIN_UI_SELECTORS } from './constants';

type DomQueryOptions = {
  root?: ParentNode;
};

const BLOCK_TEXT_SELECTORS = [
  '.block-content',
  '.block-content-wrapper',
  '.block-content-inner',
  '.block-content-inline',
].join(', ');

const GENERIC_REFERENCE_PANE_TITLES = new Set(['block references']);
const GENERIC_REFERENCE_PANE_DATASET_KEY = 'panesModeGenericReferencePane';
const DB_HEADER_TITLE_READ_SELECTORS = [
  '.sidebar-item-header .page-title > span.overflow-hidden.text-ellipsis',
  '.sidebar-item-header .page-title > span',
  '.sidebar-item-header .page-title',
];
const DB_HEADER_TITLE_WRITE_SELECTORS = [
  '.sidebar-item-header .page-title > span.overflow-hidden.text-ellipsis',
  '.sidebar-item-header .page-title > span',
];
const LEGACY_PANE_CLOSE_BUTTON_SELECTORS = ['[title="Close"]', '[aria-label="Close"]'];
const DB_PANE_CLOSE_BUTTON_SELECTORS = [
  '.sidebar-item-header [title="Close"]',
  '.sidebar-item-header [aria-label="Close"]',
];
const DB_PANE_CLOSE_ICON_SELECTORS = ['.ls-icon-x', '.tabler-icon-x', '.ti.ls-icon-x'].join(
  ', '
);

const normalizePaneTitle = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const isUuidLike = (value: string): boolean => {
  const trimmedValue = value.trim();

  return /^[0-9a-f-]{16,}$/i.test(trimmedValue) && trimmedValue.includes('-');
};

export const queryParent = <T extends Element>(
  selector: string,
  options: DomQueryOptions = {}
): T | null => {
  const root = options.root ?? parent.document;

  return root.querySelector(selector) as T | null;
};

export const getParentElementById = <T extends HTMLElement>(id: string): T | null => {
  return parent.document.getElementById(id) as T | null;
};

export function isElementVerticallyInViewport(
  element: HTMLElement,
  container?: HTMLElement,
  threshold: number = 0
): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const containerRect = container?.getBoundingClientRect() ?? rect;
  const elementHeight = rect.height;
  const visibleHeight =
    Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top);

  return (
    visibleHeight >= elementHeight * threshold &&
    rect.top < containerRect.bottom &&
    rect.bottom > containerRect.top
  );
}

export const arePanesDifferent = (
  firstElementsList: Element[],
  secondElementsList: Element[]
): boolean => {
  if (!firstElementsList || !secondElementsList) return true;
  if (firstElementsList.length !== secondElementsList.length) return true;
  for (let i = 0; i < firstElementsList.length; i++) {
    if (firstElementsList[i] !== secondElementsList[i]) return true;
  }

  return false;
};

export const getScrollablePanesContainer = (): HTMLElement | null => {
  return queryParent<HTMLElement>(LOGSEQ_UI_SELECTORS.panesContainer);
};

export const getTabsContainer = (isVerticalTabs: boolean): HTMLElement | null => {
  const selector = isVerticalTabs
    ? PLUGIN_UI_SELECTORS.tabsVertical
    : PLUGIN_UI_SELECTORS.tabsHorizontal;

  return queryParent<HTMLElement>(selector);
};

export const getRightSidebarContainer = (): HTMLElement | null => {
  return queryParent<HTMLElement>(LOGSEQ_UI_SELECTORS.rightSidebarContainer);
};

export const getRightSidebar = (): HTMLElement | null => {
  return queryParent<HTMLElement>(LOGSEQ_UI_SELECTORS.rightSidebar);
};

export const getLeftSidebar = (): HTMLElement | null => {
  return queryParent<HTMLElement>(LOGSEQ_UI_SELECTORS.leftSidebar);
};

export const getLeftContainer = (): HTMLElement | null => {
  return queryParent<HTMLElement>(LOGSEQ_UI_SELECTORS.leftContainer);
};

export const getMainContent = (): HTMLElement | null => {
  return queryParent<HTMLElement>(LOGSEQ_UI_SELECTORS.mainContent);
};

export const getPaneCloseButton = (pane: Element): HTMLElement | null => {
  if (APP_SETTINGS_CONFIG.isDBVersion) {
    return (
      getFirstPaneCloseButtonBySelectors(pane, DB_PANE_CLOSE_BUTTON_SELECTORS) ??
      getDbPaneCloseButtonByIcon(pane) ??
      getFirstPaneCloseButtonBySelectors(pane, LEGACY_PANE_CLOSE_BUTTON_SELECTORS)
    );
  }

  return getFirstPaneCloseButtonBySelectors(pane, LEGACY_PANE_CLOSE_BUTTON_SELECTORS);
};

const getFirstPaneCloseButtonBySelectors = (
  pane: Element,
  selectors: string[]
): HTMLElement | null => {
  for (const selector of selectors) {
    const button = pane.querySelector<HTMLElement>(selector);
    if (button) return button;
  }

  return null;
};

const getDbPaneCloseButtonByIcon = (pane: Element): HTMLElement | null => {
  const paneHeader = pane.querySelector<HTMLElement>('.sidebar-item-header') ?? pane;
  const buttonCandidates = Array.from(
    paneHeader.querySelectorAll<HTMLElement>('button, [role="button"]')
  );

  return (
    buttonCandidates.find(button => Boolean(button.querySelector(DB_PANE_CLOSE_ICON_SELECTORS))) ??
    null
  );
};

const getHeaderTitleElementsBySelectors = (
  pane: Element,
  selectors: string[]
): HTMLElement[] => {
  for (const selector of selectors) {
    const titleElements = Array.from(pane.querySelectorAll<HTMLElement>(selector)).filter(el =>
      Boolean(el.textContent?.trim())
    );
    if (titleElements.length > 0) return titleElements;
  }

  return [];
};

const getHeaderPaneTitleElements = (pane: Element): HTMLElement[] => {
  if (APP_SETTINGS_CONFIG.isDBVersion) {
    const dbTitleElements = getHeaderTitleElementsBySelectors(pane, DB_HEADER_TITLE_READ_SELECTORS);
    if (dbTitleElements.length > 0) return dbTitleElements;
  }

  return getHeaderTitleElementsBySelectors(pane, [LOGSEQ_UI_SELECTORS.tabTitle]);
};

const getEditableHeaderPaneTitleElement = (pane: Element): HTMLElement | null => {
  if (APP_SETTINGS_CONFIG.isDBVersion) {
    const dbTitleElements = getHeaderTitleElementsBySelectors(
      pane,
      DB_HEADER_TITLE_WRITE_SELECTORS
    );
    if (dbTitleElements.length > 0) return dbTitleElements[0];
  }

  return pane.querySelector(LOGSEQ_UI_SELECTORS.tabTitle) as HTMLElement | null;
};

const getHeaderPaneTitleParts = (pane: Element): string[] => {
  const titleElements = getHeaderPaneTitleElements(pane);
  if (titleElements.length === 0) return [];

  return Array.from(titleElements)
    .map(el => el.textContent?.trim())
    .filter(Boolean);
};

export const getHeaderPaneTitle = (pane: Element): string | null => {
  const parts = getHeaderPaneTitleParts(pane);

  return parts.length > 0 ? parts.join(' > ') : null;
};

const isGenericReferencePaneTitle = (title: string | null): boolean =>
  title ? GENERIC_REFERENCE_PANE_TITLES.has(normalizePaneTitle(title)) : false;

const isGenericReferencePane = (pane: Element): boolean => {
  const paneElement = pane as HTMLElement;

  return (
    paneElement.dataset[GENERIC_REFERENCE_PANE_DATASET_KEY] === 'true' ||
    isGenericReferencePaneTitle(getHeaderPaneTitle(pane))
  );
};

const getBlockText = (blockElement: Element): string | null => {
  const contentElement = blockElement.querySelector(BLOCK_TEXT_SELECTORS) as HTMLElement | null;
  const text = (contentElement ?? blockElement).textContent?.replace(/\s+/g, ' ').trim();

  return text ? text : null;
};

const getBlockCandidateElements = (pane: Element): HTMLElement[] => {
  const blockElements = Array.from(pane.querySelectorAll<HTMLElement>('[blockid]'));

  return blockElements.length > 0
    ? blockElements
    : Array.from(pane.querySelectorAll<HTMLElement>('.block-ref[data-uuid]'));
};

const getTopLevelBlockElements = (pane: Element): HTMLElement[] => {
  const blockElements = getBlockCandidateElements(pane);
  if (blockElements.length === 0) return [];

  const hasBlockIds = blockElements.some(block => block.hasAttribute('blockid'));
  if (!hasBlockIds) return blockElements;

  return blockElements.filter(block => {
    const parentBlock = block.parentElement?.closest<HTMLElement>('[blockid]');

    return !parentBlock || !pane.contains(parentBlock);
  });
};

const getHighestCurrentBlockElement = (pane: Element): HTMLElement | null => {
  const topLevelBlocks = getTopLevelBlockElements(pane);
  if (topLevelBlocks.length === 0) return null;

  for (const topLevelBlock of topLevelBlocks) {
    const nestedBlock = Array.from(topLevelBlock.querySelectorAll<HTMLElement>('[blockid]')).find(
      block => block !== topLevelBlock && Boolean(getBlockText(block))
    );
    if (nestedBlock) return nestedBlock;
  }

  return topLevelBlocks.slice(1).find(block => Boolean(getBlockText(block))) ?? null;
};

const getRepresentativeBlockElement = (pane: Element): HTMLElement | null => {
  const highestCurrentBlock = isGenericReferencePane(pane)
    ? getHighestCurrentBlockElement(pane)
    : null;
  if (highestCurrentBlock) return highestCurrentBlock;

  const candidateElements = getBlockCandidateElements(pane);
  if (candidateElements.length === 0) return null;

  const preferredBlock = candidateElements.find(block => {
    const text = getBlockText(block);

    return text ? (block.getAttribute('data-refs-self') ?? '').trim() === '' : false;
  });
  if (preferredBlock) return preferredBlock;

  return candidateElements.find(block => Boolean(getBlockText(block))) ?? null;
};

const getContentDerivedPaneTitle = (pane: Element): string | null => {
  const blockElement = getRepresentativeBlockElement(pane);

  return blockElement ? getBlockText(blockElement) : null;
};

export const getPaneTitle = (pane: Element): string => {
  const headerTitle = getHeaderPaneTitle(pane);
  if (headerTitle && !isGenericReferencePane(pane)) {
    return headerTitle;
  }

  const contentDerivedTitle = getContentDerivedPaneTitle(pane);
  if (contentDerivedTitle) return contentDerivedTitle;

  // TODO: Check that it wont parse Page/Block icon

  return headerTitle ?? 'Untitled';
};

export const syncPaneHeaderTitle = (pane: Element): void => {
  const paneElement = pane as HTMLElement;
  const headerTitle = getHeaderPaneTitle(pane);
  if (!isGenericReferencePaneTitle(headerTitle)) {
    delete paneElement.dataset[GENERIC_REFERENCE_PANE_DATASET_KEY];

    return;
  }
  paneElement.dataset[GENERIC_REFERENCE_PANE_DATASET_KEY] = 'true';

  const contentDerivedTitle = getContentDerivedPaneTitle(pane);
  if (!contentDerivedTitle) return;

  const headerTitleElement = getEditableHeaderPaneTitleElement(pane);
  if (!headerTitleElement || headerTitleElement.textContent?.trim() === contentDerivedTitle) return;

  headerTitleElement.textContent = contentDerivedTitle;
};

const getPaneAttributeId = (element: HTMLElement | null): string | null => {
  if (!element) return null;

  const attributeValue =
    element.getAttribute('data-page') ??
    element.getAttribute('data-page-name') ??
    element.getAttribute('data-refs-self');

  const trimmedValue = attributeValue?.trim();

  return trimmedValue ? trimmedValue : null;
};

const getUuidElementId = (element: HTMLElement | null): string | null => {
  if (!element?.id) return null;
  const trimmedId = element.id.trim();

  return isUuidLike(trimmedId) ? trimmedId : null;
};

const getRepresentativeBlockId = (pane: Element): string | null => {
  const blockElement = getRepresentativeBlockElement(pane);
  if (!blockElement) return null;

  const blockId = blockElement.getAttribute('blockid')?.trim();
  if (blockId) return blockId;

  const dataUuid = blockElement.getAttribute('data-uuid')?.trim();
  if (dataUuid) return dataUuid;

  const nestedBlockRef = blockElement.querySelector<HTMLElement>('.block-ref[data-uuid]');
  const nestedBlockRefId = nestedBlockRef?.getAttribute('data-uuid')?.trim();
  if (nestedBlockRefId) return nestedBlockRefId;

  return getUuidElementId(blockElement);
};

const getUuidFromPaneDom = (pane: Element): string | null => {
  const paneElement = pane as HTMLElement;
  const contentWrapper = pane.querySelector(
    LOGSEQ_UI_SELECTORS.paneContentWrapper
  ) as HTMLElement | null;

  const paneElementId = getUuidElementId(paneElement);
  if (paneElementId) return paneElementId;

  const contentWrapperId = getUuidElementId(contentWrapper);
  if (contentWrapperId) return contentWrapperId;

  if (contentWrapper) {
    let currentParent = contentWrapper.parentElement as HTMLElement | null;
    while (currentParent && currentParent !== paneElement) {
      const currentParentId = getUuidElementId(currentParent);
      if (currentParentId) return currentParentId;
      currentParent = currentParent.parentElement;
    }
  }

  return null;
};

// Returns the pane's uuid when one is available (from the DOM or a cached
// resolution), otherwise null. Never falls back to the pane title, so
// consumers can distinguish "uuid not resolved yet" from "no stable id".

// Per-pane cache of the pane's final committed id: a uuid when one exists
// (from the DOM or the plugin API), otherwise the fallback (title). Uuid-pure
// readers (getPaneUuidFromPane, startPaneUuidResolution) filter with
// isUuidLike so fallback entries stay invisible; final-key readers
// (getResolvedPaneId/getResolvedPaneIdSync) read raw.
const resolvedPaneIds = new WeakMap<Element, string | null>();

// In-flight API resolution promises, so every consumer awaits the same
// resolution instead of issuing duplicate getPage calls.
const pendingUuidResolutions = new WeakMap<Element, Promise<string | null>>();

// Kicks off (or reuses) the pane uuid resolution via the plugin API and
// returns the promise. Called at pane birth so the API round-trip starts
// immediately; the settled uuid is cached and read synchronously by
// getPaneUuidFromPane afterwards. Only uuid-shaped cached values count as
// settled — a committed fallback is not a resolution.
export const startPaneUuidResolution = (pane: Element): Promise<string | null> => {
  const settled = resolvedPaneIds.get(pane);
  if (settled && isUuidLike(settled)) return Promise.resolve(settled);

  const pending = pendingUuidResolutions.get(pane);
  if (pending) return pending;

  const promise = resolvePaneUuidViaApi(pane).finally(() => {
    pendingUuidResolutions.delete(pane);
  });
  pendingUuidResolutions.set(pane, promise);

  return promise;
};

// Best-effort async resolver: returns the page uuid for plain page panes,
// null for block/reference panes (their uuid is in the DOM) and when the
// header title is not a resolvable page name. Results are cached per pane
// element once settled.
const resolvePaneUuidViaApi = async (pane: Element): Promise<string | null> => {
  if (getUuidFromPaneDom(pane)) return null; // DOM uuid already available
  if (isGenericReferencePane(pane)) return null; // reference panes use DOM blockid

  const header = getHeaderPaneTitle(pane);
  // Breadcrumb ("Page > block text") means a block pane, not a page pane;
  // resolving arbitrary block text as a page name would misidentify the pane.
  if (!header || header.includes(' > ')) return null;

  try {
    const page = await logseq.Editor.getPage(header);
    if (page?.uuid) {
      resolvedPaneIds.set(pane, page.uuid);
      return page.uuid;
    }
  } catch {
    return null;
  }

  return null;
};

export const getPaneUuidFromPane = (pane: Element): string | null => {
  const paneElement = pane as HTMLElement;
  const contentWrapper = pane.querySelector(
    LOGSEQ_UI_SELECTORS.paneContentWrapper
  ) as HTMLElement | null;
  const isReferencePane = isGenericReferencePane(pane);

  // Only uuid-shaped attribute ids (data-page/data-refs-self holding a block
  // uuid) are unique enough; page-name attributes are not.
  const attributeId = getPaneAttributeId(paneElement) ?? getPaneAttributeId(contentWrapper);
  if (attributeId && !isReferencePane && isUuidLike(attributeId)) return attributeId;

  const domUuid = getUuidFromPaneDom(pane);
  if (domUuid) return domUuid;

  if (isReferencePane) {
    const representativeBlockId = getRepresentativeBlockId(pane);
    if (representativeBlockId) return representativeBlockId;
  }

  // Last resort before giving up: a uuid already cached (API-resolved or
  // DOM-rendered). Filtered by isUuidLike so a committed fallback (title/
  // attribute) is never mistaken for a uuid.
  const cached = resolvedPaneIds.get(pane);
  if (cached && isUuidLike(cached)) return cached;

  return null;
};

// Best-effort stable id: the uuid when one exists, otherwise the pane title
// (for panes whose DOM/API never yield a uuid).
export const getPaneIdFromPane = (pane: Element): string | null => {
  const uuid = getPaneUuidFromPane(pane);
  if (uuid) return uuid;

  const paneTitle = getPaneTitle(pane);

  return paneTitle !== 'Untitled' ? paneTitle : null;
};

// Synchronous read of the committed id, for comparisons in the sync loop.
export const getResolvedPaneIdSync = (pane: Element): string | null => {
  const cached = resolvedPaneIds.get(pane);

  return cached === undefined ? null : cached;
};

// Async resolution of the pane's final id: cached -> DOM uuid -> plugin API
// (page panes) -> title fallback. Cached per pane so every consumer (tabs,
// panes order, last-active, cleanup) reads the same key.
export const getResolvedPaneId = async (pane: Element): Promise<string | null> => {
  const cached = resolvedPaneIds.get(pane);
  if (cached !== undefined) return cached;

  const uuid = getPaneUuidFromPane(pane);
  if (uuid) {
    resolvedPaneIds.set(pane, uuid);
    return uuid;
  }

  const apiUuid = await startPaneUuidResolution(pane);
  if (apiUuid) return apiUuid;

  const final = getPaneIdFromPane(pane);
  resolvedPaneIds.set(pane, final);

  return final;
};

export const isRightSidebarVisible = (): boolean => Boolean(getRightSidebarContainer());

export const getPaneIdToElementMap = (panes: Element[]): Map<string, Element> => {
  const idToPaneMap = new Map<string, Element>();
  panes.forEach(pane => {
    const pageId = getPaneIdFromPane(pane);
    if (pageId) idToPaneMap.set(pageId, pane);
  });

  return idToPaneMap;
};
