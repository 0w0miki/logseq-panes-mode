import logoSvg from '../../icons/logo.svg';
import resetSvg from '../../icons/reset.svg';
import hideLeftSvg from '../../icons/hide-left.svg';
import showLeftSvg from '../../icons/show-left.svg';
import cleanUnusedSvg from '../../icons/clean-unused.svg';
import syncOrderSvg from '../../icons/sync-order.svg';

const withSize = (svg: string, size: number): string =>
  svg.replace(/width="20"/, `width="${size}"`).replace(/height="20"/, `height="${size}"`);

export const toolbarIcons = {
  logo: (size: number) => withSize(logoSvg, size),
  reset: (size: number) => withSize(resetSvg, size),
  hideMain: (size: number) => withSize(hideLeftSvg, size),
  showMain: (size: number) => withSize(showLeftSvg, size),
  cleanUnused: (size: number) => withSize(cleanUnusedSvg, size),
  syncOrder: (size: number) => withSize(syncOrderSvg, size),
};
