import {
  MapPinned, Route, ShieldCheck, CalendarDays, TrendingUp,
  Bell, Camera, Search, X, Check, AlertTriangle, WifiOff,
  Mail, Lock, Eye, EyeOff, LogIn, UserPlus, Smartphone, LogOut, User,
  ChevronLeft, ChevronRight, RotateCcw, Leaf, HelpCircle, XOctagon, Send, ScanLine,
  MapPin, Crosshair, Grid3x3, Info, CircleCheck, Clock, ImagePlus,
  SlidersHorizontal, Filter, Navigation, ClipboardList,
  type LucideIcon,
} from 'lucide-react'

const REGISTRY: Record<string, LucideIcon> = {
  MapPinned, Route, ShieldCheck, CalendarDays, TrendingUp,
  Bell, Camera, Search, X, Check, AlertTriangle, WifiOff,
  Mail, Lock, Eye, EyeOff, LogIn, UserPlus, Smartphone, LogOut, User,
  ChevronLeft, ChevronRight, RotateCcw, Leaf, HelpCircle, XOctagon, Send, ScanLine,
  MapPin, Crosshair, Grid3x3, Info, CircleCheck, Clock, ImagePlus,
  SlidersHorizontal, Filter, Navigation, ClipboardList,
}

interface Props { name: string; size?: number; color?: string; strokeWidth?: number }

export function Icon({ name, size = 19, color = 'currentColor', strokeWidth = 1.9 }: Props) {
  const Cmp = REGISTRY[name]
  if (!Cmp) return <span style={{ width: size, height: size, display: 'inline-block', flexShrink: 0 }} />
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} aria-hidden="true" />
}
