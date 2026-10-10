import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Cigarette,
  CigaretteOff,
  CircleCheck,
  CircleHelp,
  Clock,
  Coffee,
  Flag,
  Flame,
  Footprints,
  Hand,
  Hourglass,
  LogIn,
  LogOut,
  Maximize2,
  MessageCircle,
  Minimize2,
  Moon,
  RotateCcw,
  Sun,
  Sunrise,
  Sunset,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "./labels.ts";

const ICONS: Record<IconName, LucideIcon> = {
  arrived: LogIn,
  permission: Flame,
  question: CircleHelp,
  input: Hand,
  waiting: Hourglass,
  approved: Cigarette,
  denied: CigaretteOff,
  answered: MessageCircle,
  error: TriangleAlert,
  done: CircleCheck,
  coffee: Coffee,
  friendIn: UserPlus,
  friendOut: UserMinus,
  dozing: Moon,
  woke: Sunrise,
  leaving: LogOut,
  gone: Footprints,
  reset: RotateCcw,
  compact: Minimize2,
  expand: Maximize2,
  soundOn: Volume2,
  soundOff: VolumeX,
  bellOn: Bell,
  bellOff: BellOff,
  day: Sun,
  night: Moon,
  morning: Sunrise,
  evening: Sunset,
  auto: Clock,
  milestone: Flag,
  collapse: ChevronUp,
  expandList: ChevronDown,
  close: X,
};

/** A stroke icon sized by the surrounding font, in the text colour. */
export function Icon({ name }: { name: IconName }) {
  const Svg = ICONS[name];
  return <Svg className="icon" strokeWidth={2.25} aria-hidden="true" focusable="false" />;
}

/** The blue square "P" of Indonesian parking signs. */
export const ParkingMark = () => (
  <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="7" fill="#1f5fbf" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="2" />
    <path d="M11 24V8h6.2a5 5 0 0 1 0 10H11" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinejoin="round" />
  </svg>
);
