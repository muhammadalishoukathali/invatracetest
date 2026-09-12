import {
  MapPinned, Route, ShieldCheck, CalendarDays, TrendingUp,
  Bell, Camera, Search, X, Check, AlertTriangle, WifiOff,
  User,
  ChevronLeft, ChevronRight, RotateCcw, Leaf, HelpCircle, XOctagon, Send, ScanLine,
  MapPin, Crosshair, Grid3x3, Info, CircleCheck, Clock, ImagePlus,
  SlidersHorizontal, Filter, Navigation, ClipboardList,
  Copy, Download, KeyRound, Shield, Smartphone, Trash2, RefreshCw, ExternalLink, Pencil, LogOut,
  Bookmark, BookmarkCheck, Sprout, Eye, Radar, Plus, ArrowUpRight, ArrowDownRight, Minus,
  type LucideIcon,
} from 'lucide-react'

const REGISTRY: Record<string, LucideIcon> = {
  MapPinned, Route, ShieldCheck, CalendarDays, TrendingUp,
  Bell, Camera, Search, X, Check, AlertTriangle, WifiOff,
  User,
  ChevronLeft, ChevronRight, RotateCcw, Leaf, HelpCircle, XOctagon, Send, ScanLine,
  MapPin, Crosshair, Grid3x3, Info, CircleCheck, Clock, ImagePlus,
  SlidersHorizontal, Filter, Navigation, ClipboardList,
  Copy, Download, KeyRound, Shield, Smartphone, Trash2, RefreshCw, ExternalLink, Pencil, LogOut,
  Bookmark, BookmarkCheck, Sprout, Eye, Radar, Plus, ArrowUpRight, ArrowDownRight, Minus,
}

interface Props { name: string; size?: number; color?: string; strokeWidth?: number }

/**
 * Basically a name-to-component lookup for Lucide icons. The reason this
 * exists instead of just importing icons directly wherever I need them is
 * that stuff like src/app/nav.ts is data-driven - the nav items are just
 * plain objects with an icon name string, and this is what turns that string
 * back into an actual icon.
 */
export function Icon({ name, size = 19, color = 'currentColor', strokeWidth = 1.9 }: Props) {
  const Cmp = REGISTRY[name]
  // if the name doesn't match anything (typo in NAV, or I just forgot to add
  // it to REGISTRY) this renders an empty placeholder instead of throwing -
  // better a missing icon than the whole screen crashing over it
  if (!Cmp) return <span style={{ width: size, height: size, display: 'inline-block', flexShrink: 0 }} />
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} aria-hidden="true" />
}
