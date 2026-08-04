import { LOGSEQ_UI_SELECTORS } from '../../core/constants';
import { manageActionButtonsPosition } from '../../core/layout/layout';
import { debugWarn } from '../../core/logger';

export const initLeftSidebarObserver = (): MutationObserver | null => {
  const leftSidebar = parent.document.querySelector<HTMLElement>(LOGSEQ_UI_SELECTORS.leftSidebar);
  let isLeftSidebarOpenCached = leftSidebar?.classList.contains('is-open') || false;
  if (!leftSidebar) {
    debugWarn('Left sidebar not found, skipping toggle observer setup.');

    return null;
  }
  const leftSidebarToggleObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') return;
      const sidebarElement = mutation.target as HTMLElement;
      const isLeftSideBarOpen = sidebarElement.classList.contains('is-open');
      if (!isLeftSideBarOpen !== isLeftSidebarOpenCached) return;
      isLeftSidebarOpenCached = isLeftSideBarOpen;

      const rightSidebar = parent.document.querySelector(
        LOGSEQ_UI_SELECTORS.rightSidebar
      ) as HTMLElement;
      const isRightSidebarOpen = Boolean(
        rightSidebar?.querySelector(LOGSEQ_UI_SELECTORS.rightSidebarContainer)
      );
      if (!isRightSidebarOpen) return;
      const isRightSidebarExtended =
        rightSidebar.classList.contains('panes-sidebar-full') ||
        rightSidebar.classList.contains('panes-sidebar-dual');
      if (!isRightSidebarExtended) return;
      if (isLeftSideBarOpen) {
        rightSidebar.classList.remove('panes-sidebar-full');
        rightSidebar.classList.add('panes-sidebar-dual');
      } else {
        rightSidebar.classList.remove('panes-sidebar-dual');
        rightSidebar.classList.add('panes-sidebar-full');
      }
      manageActionButtonsPosition();
    });
  });
  leftSidebarToggleObserver.observe(leftSidebar, {
    attributes: true,
    attributeFilter: ['class'],
    attributeOldValue: false,
    childList: false,
  });

  return leftSidebarToggleObserver;
};
