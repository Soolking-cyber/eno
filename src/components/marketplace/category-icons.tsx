import {
  PackageOpen,
  Bike,
  Home,
  Smartphone,
  Briefcase,
  Wrench,
  Sofa,
  Shirt,
  Baby,
  Dumbbell,
  PawPrint,
  Users,
  Plane,
  UtensilsCrossed,
  Gift,
  Search,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  PackageOpen,
  Bike,
  Home,
  Smartphone,
  Briefcase,
  Wrench,
  Sofa,
  Shirt,
  Baby,
  Dumbbell,
  PawPrint,
  Users,
  Plane,
  UtensilsCrossed,
  Gift,
  Search,
}

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? HelpCircle
  return <Icon className={className} />
}

export const CATEGORY_ICONS = ICONS
