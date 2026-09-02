import {
  MapPinned, Route, ShieldCheck, CalendarDays, TrendingUp,
  Bell, Camera, Search, X, Check, AlertTriangle, WifiOff,
  User,
  ChevronLeft, ChevronRight, RotateCcw, Leaf, HelpCircle, XOctagon, Send, ScanLine,
  MapPin, Crosshair, Grid3x3, Info, CircleCheck, Clock, ImagePlus,
  SlidersHorizontal, Filter, Navigation, ClipboardList,
  Copy, Download, KeyRound, Shield, Smartphone, Trash2, RefreshCw, ExternalLink, Pencil, LogOut,
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
}

interface Props { name: string; size?: number; color?: string; strokeWidth?: number }

/**
 * Looks up a Lucide icon by string name and renders it. Used everywhere
 * instead of importing lucide-react icons directly so nav items and other
 * data-driven UI (see src/app/nav.ts) can reference icons by name.
 */
export function Icon({ name, size = 19, color = 'currentColor', strokeWidth = 1.9 }: Props) {
  const Cmp = REGISTRY[name]
  // Unknown name (e.g. a typo in NAV, or a name not yet added to REGISTRY)
  // renders an empty placeholder instead of crashing so a bad icon name
  // doesn't take down the whole screen.
  if (!Cmp) return <span style={{ width: size, height: size, display: 'inline-block', flexShrink: 0 }} />
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} aria-hidden="true" />
}
