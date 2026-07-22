import {
  ArrowLeft,
  Bell,
  BellRing,
  Box,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Grid2x2Check,
  Clock,
  Cloud,
  CloudCheck,
  Copy,
  Image,
  Info,
  List,
  Mic,
  Moon,
  Pill,
  Plus,
  RotateCcw,
  ScanLine,
  SendHorizontal,
  ShieldCheck,
  SquarePen,
  Settings,
  Sparkles,
  Sun,
  SunMedium,
  Sunset,
  Timer,
  Trash2,
  TriangleAlert,
  Undo2,
  Utensils,
  X,
  type IconNode,
} from 'lucide';

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
  | 'copy'
  | 'image'
  | 'retry'
  | 'shield'
  | 'chevron-right'
  | 'send'
  | 'close';

export const iconRegistry: Readonly<Record<AppIconName, IconNode>> = {
  pill: Pill,
  list: List,
  camera: Camera,
  gear: Settings,
  'arrow-left': ArrowLeft,
  plus: Plus,
  check: Check,
  undo: Undo2,
  info: Info,
  warn: TriangleAlert,
  edit: SquarePen,
  bell: Bell,
  'bell-ring': BellRing,
  cloud: Cloud,
  'cloud-check': CloudCheck,
  copy: Copy,
  box: Box,
  sparkles: Sparkles,
  trash: Trash2,
  clock: Clock,
  timer: Timer,
  sun: Sun,
  'sun-high': SunMedium,
  sunset: Sunset,
  moon: Moon,
  utensils: Utensils,
  calendar: CalendarDays,
  scan: ScanLine,
  pillbox: Grid2x2Check,
  mic: Mic,
  image: Image,
  retry: RotateCcw,
  shield: ShieldCheck,
  'chevron-right': ChevronRight,
  send: SendHorizontal,
  close: X,
};
