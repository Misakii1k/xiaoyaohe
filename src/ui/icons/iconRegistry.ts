import pillSvg from '@tabler/icons/icons/outline/pill.svg?raw';
import listSvg from '@tabler/icons/icons/outline/list.svg?raw';
import cameraSvg from '@tabler/icons/icons/outline/camera.svg?raw';
import gearSvg from '@tabler/icons/icons/outline/settings.svg?raw';
import arrowLeftSvg from '@tabler/icons/icons/outline/arrow-left.svg?raw';
import plusSvg from '@tabler/icons/icons/outline/plus.svg?raw';
import checkSvg from '@tabler/icons/icons/outline/check.svg?raw';
import undoSvg from '@tabler/icons/icons/outline/arrow-back-up.svg?raw';
import infoSvg from '@tabler/icons/icons/outline/info-circle.svg?raw';
import warnSvg from '@tabler/icons/icons/outline/alert-triangle.svg?raw';
import editSvg from '@tabler/icons/icons/outline/edit.svg?raw';
import bellSvg from '@tabler/icons/icons/outline/bell.svg?raw';
import bellRingSvg from '@tabler/icons/icons/outline/bell-ringing.svg?raw';
import cloudSvg from '@tabler/icons/icons/outline/cloud.svg?raw';
import cloudCheckSvg from '@tabler/icons/icons/outline/cloud-check.svg?raw';
import copySvg from '@tabler/icons/icons/outline/copy.svg?raw';
import boxSvg from '@tabler/icons/icons/outline/package.svg?raw';
import sparklesSvg from '@tabler/icons/icons/outline/sparkle.svg?raw';
import trashSvg from '@tabler/icons/icons/outline/trash.svg?raw';
import clockSvg from '@tabler/icons/icons/outline/clock.svg?raw';
import timerSvg from '@tabler/icons/icons/outline/stopwatch.svg?raw';
import sunSvg from '@tabler/icons/icons/outline/sun.svg?raw';
import sunHighSvg from '@tabler/icons/icons/outline/sun-high.svg?raw';
import sunsetSvg from '@tabler/icons/icons/outline/sunset.svg?raw';
import moonSvg from '@tabler/icons/icons/outline/moon.svg?raw';
import utensilsSvg from '@tabler/icons/icons/outline/tools-kitchen.svg?raw';
import calendarSvg from '@tabler/icons/icons/outline/calendar.svg?raw';
import scanSvg from '@tabler/icons/icons/outline/scan.svg?raw';
import pillboxSvg from '@tabler/icons/icons/outline/layout-grid.svg?raw';
import micSvg from '@tabler/icons/icons/outline/microphone.svg?raw';
import imageSvg from '@tabler/icons/icons/outline/photo.svg?raw';
import retrySvg from '@tabler/icons/icons/outline/rotate.svg?raw';
import shieldSvg from '@tabler/icons/icons/outline/shield-check.svg?raw';
import chevronRightSvg from '@tabler/icons/icons/outline/chevron-right.svg?raw';
import sendSvg from '@tabler/icons/icons/outline/send.svg?raw';
import shareSvg from '@tabler/icons/icons/outline/share.svg?raw';
import closeSvg from '@tabler/icons/icons/outline/x.svg?raw';
import plugSvg from '@tabler/icons/icons/outline/plug-connected.svg?raw';
import robotSvg from '@tabler/icons/icons/outline/robot.svg?raw';
import lockSvg from '@tabler/icons/icons/outline/lock.svg?raw';
import devicesSvg from '@tabler/icons/icons/outline/devices.svg?raw';

export type AppIconName =
  | 'pill'
  | 'list'
  | 'camera'
  | 'gear'
  | 'arrow-left'
  | 'plus'
  | 'check'
  | 'undo'
  | 'info'
  | 'warn'
  | 'edit'
  | 'bell'
  | 'bell-ring'
  | 'cloud'
  | 'cloud-check'
  | 'copy'
  | 'box'
  | 'sparkles'
  | 'trash'
  | 'clock'
  | 'timer'
  | 'sun'
  | 'sun-high'
  | 'sunset'
  | 'moon'
  | 'utensils'
  | 'calendar'
  | 'scan'
  | 'pillbox'
  | 'mic'
  | 'image'
  | 'retry'
  | 'shield'
  | 'plug'
  | 'robot'
  | 'lock'
  | 'devices'
  | 'chevron-right'
  | 'send'
  | 'share'
  | 'close';

export const iconRegistry: Readonly<Record<AppIconName, string>> = {
  pill: pillSvg,
  list: listSvg,
  camera: cameraSvg,
  gear: gearSvg,
  'arrow-left': arrowLeftSvg,
  plus: plusSvg,
  check: checkSvg,
  undo: undoSvg,
  info: infoSvg,
  warn: warnSvg,
  edit: editSvg,
  bell: bellSvg,
  'bell-ring': bellRingSvg,
  cloud: cloudSvg,
  'cloud-check': cloudCheckSvg,
  copy: copySvg,
  box: boxSvg,
  sparkles: sparklesSvg,
  trash: trashSvg,
  clock: clockSvg,
  timer: timerSvg,
  sun: sunSvg,
  'sun-high': sunHighSvg,
  sunset: sunsetSvg,
  moon: moonSvg,
  utensils: utensilsSvg,
  calendar: calendarSvg,
  scan: scanSvg,
  pillbox: pillboxSvg,
  mic: micSvg,
  image: imageSvg,
  retry: retrySvg,
  shield: shieldSvg,
  plug: plugSvg,
  robot: robotSvg,
  lock: lockSvg,
  devices: devicesSvg,
  'chevron-right': chevronRightSvg,
  send: sendSvg,
  share: shareSvg,
  close: closeSvg,
};
