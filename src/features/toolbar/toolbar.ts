import { toolbarIcons } from './icons';

const TOOLBAR_ICON_SIZE_PX = 20;

export const registerToolbarUIItems = (): void => {
  const registerUIItem = (interfacePlace: 'toolbar', key: string, template: string) =>
    logseq.App.registerUIItem(interfacePlace, {
      key,
      template,
    });

  registerUIItem('toolbar', 'PanesMode_mode_on_off', toolbarButtons.togglePanesMode);
  registerUIItem('toolbar', 'Hide_main_content', toolbarButtons.hideMain);
  registerUIItem('toolbar', 'Show_main_content', toolbarButtons.showMain);
  registerUIItem('toolbar', 'Close_unused_panes', toolbarButtons.cleanUnused);
  registerUIItem('toolbar', 'Reset_PanesMode_settings', toolbarButtons.resetSettings);
  registerUIItem('toolbar', 'Sync_panes_order', toolbarButtons.syncOrder);
};

const buildToolbarButtonTemplate = (action: string, iconMarkup: string, label: string): string => {
  return `
      <a
        class="button actionButton"
        data-on-click="${action}"
        title="${label}"
        aria-label="${label}"
      >
        <span class="actionButton-icon" aria-hidden="true">${iconMarkup}</span>
      </a>
    `;
};

const toolbarButtons = {
  togglePanesMode: buildToolbarButtonTemplate(
    'togglePanesModeMode',
    toolbarIcons.logo(TOOLBAR_ICON_SIZE_PX),
    'Toggle PanesMode'
  ),
  hideMain: buildToolbarButtonTemplate(
    'hideMainContent',
    toolbarIcons.hideMain(TOOLBAR_ICON_SIZE_PX),
    'Hide main content'
  ),
  showMain: buildToolbarButtonTemplate(
    'showMainContent',
    toolbarIcons.showMain(TOOLBAR_ICON_SIZE_PX),
    'Show main content'
  ),
  cleanUnused: buildToolbarButtonTemplate(
    'cleanUnusedPanes',
    toolbarIcons.cleanUnused(TOOLBAR_ICON_SIZE_PX),
    'Clean unused panes'
  ),
  resetSettings: buildToolbarButtonTemplate(
    'resetPanesModeSettings',
    toolbarIcons.reset(TOOLBAR_ICON_SIZE_PX),
    'Reset PanesMode settings'
  ),
  syncOrder: buildToolbarButtonTemplate(
    'syncPanesOrder',
    toolbarIcons.syncOrder(TOOLBAR_ICON_SIZE_PX),
    'Sync panes order'
  ),
};
