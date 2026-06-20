'use client'

import { useCallback, useEffect, useMemo, useState, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Inbox,
  Grid,
  List,
  MapPin,
  ChevronRight,
  ChevronDown,
  Phone,
  Layers,
  X,
  Sliders,
  Clock,
  Map,
  BadgeCheck,
} from 'lucide-react'
import type { SerializedListing, SerializedCategory } from '@/lib/types'
import { CATEGORY_COLOR_CLASSES, timeAgo } from '@/lib/types'
import { Price } from './price'
import { CategoryIcon } from './category-icons'
import { ListingCard } from './listing-card'
import { CardRow } from './card-row'
import { cn } from '@/lib/utils'
import { useLanguage, Tr } from '@/context/language-context'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import dynamic from 'next/dynamic'

const ListingsMap = dynamic(() => import('./listings-map').then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-100 flex flex-col items-center justify-center gap-2 select-none animate-pulse">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0a66c2] border-t-transparent" />
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        Loading Map...
      </span>
    </div>
  )
})

const ListingDetailDialog = dynamic(() => import('./listing-detail-dialog').then((m) => m.ListingDetailDialog), {
  ssr: false
})

type SortKey = 'newest' | 'price-low' | 'price-high' | 'popular' | 'verified-first'
type ViewMode = 'compact' | 'grid' | 'map'

type Props = {
  categories: SerializedCategory[]
  initialListings: SerializedListing[]
  initialTotal?: number
  initialFetchedAt?: number
  listingsRef?: React.RefObject<HTMLDivElement | null>
}

// Deterministic phone numbers mapped to seller IDs
const DISTRICTS = [
  { slug: 'all', name: 'Toàn bộ HCMC', nameEn: 'All HCMC' },
  { slug: 'd1', name: 'Quận 1', nameEn: 'District 1' },
  { slug: 'd3', name: 'Quận 3', nameEn: 'District 3' },
  { slug: 'd4', name: 'Quận 4', nameEn: 'District 4' },
  { slug: 'd7', name: 'Quận 7 (Phú Mỹ Hưng)', nameEn: 'District 7 (Phu My Hung)' },
  { slug: 'binh-thanh', name: 'Bình Thạnh', nameEn: 'Binh Thanh District' },
  { slug: 'thu-duc', name: 'TP Thủ Đức (Thảo Điền / D2)', nameEn: 'Thu Duc City (Thao Dien / D2)' },
  { slug: 'phu-nhuan', name: 'Phú Nhuận', nameEn: 'Phu Nhuan District' },
  { slug: 'tan-binh', name: 'Tân Bình', nameEn: 'Tan Binh District' },
]

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
  activeClassName?: string
  icon?: React.ReactNode
  wrapperClassName?: string
}

function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
  activeClassName,
  icon,
  wrapperClassName,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number }>({ top: 0, left: 0, minWidth: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Position the portaled menu under the trigger (fixed coords, viewport-clamped).
  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const menuW = Math.min(288, Math.max(r.width, 176))
    const left = Math.min(r.left, window.innerWidth - menuW - 8)
    setPos({ top: r.bottom + 8, left: Math.max(8, left), minWidth: r.width })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    reposition()
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setIsOpen(false)
    }
    // Reposition while open so the menu stays glued to the trigger (the facet row
    // scrolls horizontally; the page can scroll vertically).
    const onScroll = () => reposition()
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [isOpen, reposition])

  const selectedOption = options.find(o => o.value === value)

  return (
    <div ref={containerRef} className={cn('relative', wrapperClassName ?? 'w-full')}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex w-full items-center justify-between rounded-full px-3.5 py-2 text-sm font-semibold outline-none transition-colors cursor-pointer",
          value !== 'all' && value !== 'newest'
            ? (activeClassName ?? "bg-[#e8f1fb] text-[#0a66c2]")
            : "bg-[#f1f5f9] text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2]",
          className
        )}
      >
        <span className="flex items-center gap-1.5 truncate">
          {icon}
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform shrink-0 ml-1.5", isOpen && "rotate-180")} />
      </button>

      {/* Menu is portaled to <body> so the overflow-x scroll row can't clip it. */}
      {isOpen && mounted && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth }}
          className="z-[100] w-max max-w-[18rem] overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.08)] max-h-60 overflow-y-auto scroll-thin animate-in fade-in slide-in-from-top-1 duration-75"
        >
          {options.map((opt) => {
            const isActive = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setIsOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-6 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer',
                  isActive
                    ? 'bg-[#e8f1fb] text-[#0a66c2] font-semibold'
                    : 'font-medium text-[#475569] hover:bg-[#f1f5f9]'
                )}
              >
                <span className="whitespace-nowrap">{opt.label}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

export function ListingsExplorer({
  categories,
  initialListings,
  initialTotal,
  initialFetchedAt,
  listingsRef,
}: Props) {
  const { lang, t, tr } = useLanguage()
  const [activeCategory, setActiveCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [verifiedOnly, setVerifiedOnly] = useState(true)
  const [activeDistrict, setActiveDistrict] = useState('all')
  const [conditionFilter, setConditionFilter] = useState('all') // 'all' | 'new' | 'used'
  const [priceRange, setPriceRange] = useState('all') // 'all' | 'min-max' (VND, empty max = open)
  const [customFilters, setCustomFilters] = useState<Record<string, string>>({})
  const [activeSubcategory, setActiveSubcategory] = useState('all')
  const [openMobileDistrictDropdown, setOpenMobileDistrictDropdown] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('compact')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selected, setSelected] = useState<SerializedListing | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false)
  const [showExplorer, setShowExplorer] = useState(false)

  const [listings, setListings] = useState<SerializedListing[]>(initialListings)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [subcategoryCounts, setSubcategoryCounts] = useState<Record<string, number>>({})
  const [categoryTotal, setCategoryTotal] = useState(0)
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  const [showSuggestions, setShowSuggestions] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [landingQuery, setLandingQuery] = useState('')

  const isLandingMode = useMemo(() => {
    return (
      !showExplorer &&
      activeCategory === 'all' &&
      activeDistrict === 'all' &&
      activeSubcategory === 'all' &&
      Object.keys(customFilters).length === 0
    )
  }, [showExplorer, activeCategory, activeDistrict, activeSubcategory, customFilters])

  const resetToLandingPage = useCallback(() => {
    setQuery('')
    setLandingQuery('')
    setActiveCategory('all')
    setActiveDistrict('all')
    setActiveSubcategory('all')
    setCustomFilters({})
    setPriceRange('all')
    setShowExplorer(false)
  }, [])

  // Sync showExplorer with URL/parameters on mount or change
  useEffect(() => {
    if (
      activeCategory !== 'all' ||
      query.trim() !== '' ||
      activeDistrict !== 'all' ||
      activeSubcategory !== 'all' ||
      Object.keys(customFilters).length > 0
    ) {
      setShowExplorer(true)
    }
  }, [activeCategory, query, activeDistrict, activeSubcategory, customFilters])

  // Load search history from localStorage on mount
  useEffect(() => {
    const history = localStorage.getItem('eno:recent_searches')
    if (history) {
      try {
        setRecentSearches(JSON.parse(history))
      } catch (_) {}
    }
  }, [])

  // Listen to open-mobile-filters event from Header
  useEffect(() => {
    const handleOpenFilters = () => setIsMobileFilterOpen(true)
    window.addEventListener('open-mobile-filters', handleOpenFilters)
    return () => window.removeEventListener('open-mobile-filters', handleOpenFilters)
  }, [])

  // Helper to persist search terms
  const saveSearchToHistory = useCallback((searchTerm: string) => {
    const trimmed = searchTerm.trim()
    if (!trimmed || trimmed.length < 2) return
    const history = localStorage.getItem('eno:recent_searches')
    let list: string[] = history ? JSON.parse(history) : []
    list = [trimmed, ...list.filter((item) => item !== trimmed)].slice(0, 5)
    localStorage.setItem('eno:recent_searches', JSON.stringify(list))
    setRecentSearches(list)
  }, [])

  // Match active categories for quick suggestion links
  const matchedCategories = useMemo(() => {
    if (!debouncedQuery.trim()) return []
    const q = debouncedQuery.toLowerCase().trim()
    return categories.filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.nameVi && c.nameVi.toLowerCase().includes(q))
    )
  }, [debouncedQuery, categories])

  // Match active categories for quick suggestion links in Landing Page
  const matchedCategoriesLanding = useMemo(() => {
    if (!landingQuery.trim()) return []
    const q = landingQuery.toLowerCase().trim()
    return categories.filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.nameVi && c.nameVi.toLowerCase().includes(q))
    )
  }, [landingQuery, categories])

  // Instant matching listings for the landing search (client-side, from seed).
  const landingMatches = useMemo(() => {
    const q = landingQuery.toLowerCase().trim()
    if (q.length < 1) return []
    return initialListings
      .filter((l) => `${l.title} ${l.titleVi || ''} ${l.location} ${l.category.name} ${l.category.nameVi}`.toLowerCase().includes(q))
      .slice(0, 4)
  }, [landingQuery, initialListings])

  const handleLandingSearch = useCallback((searchTerm: string) => {
    const trimmed = searchTerm.trim()
    setQuery(trimmed)
    setShowExplorer(true)
    if (trimmed.length >= 2) {
      saveSearchToHistory(trimmed)
    }
    setShowSuggestions(false)
  }, [saveSearchToHistory])

  // Global keyboard listener to focus search bar on '/'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        const input = document.getElementById('listings-search-input') as HTMLInputElement | null
        if (input) {
          input.focus()
          setShowSuggestions(true)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleCategorySelect = (slug: string) => {
    setActiveCategory(slug)
    setActiveSubcategory('all')
    setCustomFilters({})
    setPriceRange('all') // price brackets are category-specific
  }

  const handleCategoryClick = (slug: string) => {
    setOpenMobileDistrictDropdown(false)
    setActiveCategory(slug)
    setActiveSubcategory('all')
    setCustomFilters({})
    setPriceRange('all')
  }

  // URL state synchronization: Read from URL on mount and on popstate
  useEffect(() => {
    const handleUrlChange = () => {
      const params = new URLSearchParams(window.location.search)
      setQuery(params.get('q') || '')
      setActiveCategory(params.get('category') || 'all')
      setActiveDistrict(params.get('district') || 'all')
      setActiveSubcategory(params.get('subcategory') || 'all')

      // Parse custom filters starting with attr_
      const parsedAttrs: Record<string, string> = {}
      params.forEach((value, key) => {
        if (key.startsWith('attr_')) {
          parsedAttrs[key.replace('attr_', '')] = value
        }
      })
      setCustomFilters(parsedAttrs)
    }

    handleUrlChange() // Initial check
    window.addEventListener('popstate', handleUrlChange)
    return () => window.removeEventListener('popstate', handleUrlChange)
  }, [])

  // URL state synchronization: Write back to URL as filters change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    
    if (activeCategory !== 'all') {
      params.set('category', activeCategory)
    } else {
      params.delete('category')
      params.delete('subcategory')
    }

    if (query.trim()) {
      params.set('q', query.trim())
    } else {
      params.delete('q')
    }

    if (activeDistrict !== 'all') {
      params.set('district', activeDistrict)
    } else {
      params.delete('district')
    }

    if (activeSubcategory !== 'all' && activeCategory !== 'all') {
      params.set('subcategory', activeSubcategory)
    } else {
      params.delete('subcategory')
    }

    // Clear old attr_ params and set new ones
    Array.from(params.keys()).forEach((key) => {
      if (key.startsWith('attr_')) {
        params.delete(key)
      }
    })
    Object.entries(customFilters).forEach(([key, val]) => {
      if (val && val !== 'all') {
        params.set(`attr_${key}`, val)
      }
    })

    const newSearch = params.toString()
    const newUrl = newSearch ? `?${newSearch}` : window.location.pathname
    
    window.history.replaceState(null, '', newUrl)
  }, [activeCategory, query, activeDistrict, activeSubcategory, customFilters])

  // Debounce search query input to avoid making API requests on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  // Reset page to 1 whenever filters change
  useEffect(() => {
    setPage(1)
  }, [activeCategory, debouncedQuery, activeDistrict, conditionFilter, verifiedOnly, sort, activeSubcategory, customFilters, priceRange])

  // Fetch listings dynamically from API on parameter/page modifications using React Query SWR cache
  const { data: listingsData, isLoading: queryLoading, isFetching: queryFetching } = useQuery({
    queryKey: [
      'listings',
      {
        category: activeCategory,
        subcategory: activeSubcategory,
        district: activeDistrict,
        condition: conditionFilter,
        q: debouncedQuery,
        sort,
        verified: verifiedOnly ? 'true' : 'all',
        price: priceRange,
        page,
        customFilters,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (activeCategory !== 'all') params.set('category', activeCategory)
      if (activeSubcategory !== 'all') params.set('subcategory', activeSubcategory)
      if (activeDistrict !== 'all') params.set('district', activeDistrict)
      if (conditionFilter !== 'all') params.set('condition', conditionFilter)
      if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
      params.set('sort', sort)
      params.set('verified', verifiedOnly ? 'true' : 'all')
      if (priceRange !== 'all') {
        const [mn, mx] = priceRange.split('-')
        if (mn) params.set('priceMin', mn)
        if (mx) params.set('priceMax', mx)
      }

      // Serialize custom attribute filters
      Object.entries(customFilters).forEach(([key, val]) => {
        if (val && val !== 'all') {
          params.set(`attr_${key}`, val)
        }
      })

      const limit = 24
      const offset = (page - 1) * limit
      params.set('limit', String(limit))
      params.set('offset', String(offset))

      const res = await fetch(`/api/listings?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch listings')
      return res.json()
    },
    placeholderData: (previousData) => previousData,
    // Seed the DEFAULT view (page 1, no filters) with the server-rendered data so
    // React Query treats it as fresh (global staleTime 30s) and skips the
    // redundant /api/listings refetch on mount. Strictly gated — filtered/sorted
    // views get no seed and fetch normally. Must match the /api/listings shape.
    initialData:
      page === 1 && activeCategory === 'all' && activeSubcategory === 'all' &&
      activeDistrict === 'all' && conditionFilter === 'all' && priceRange === 'all' &&
      sort === 'newest' && verifiedOnly && !debouncedQuery.trim() &&
      Object.keys(customFilters).length === 0
        ? { listings: initialListings, total: initialTotal ?? initialListings.length, subcategoryCounts: {}, categoryTotal: 0 }
        : undefined,
    initialDataUpdatedAt: initialFetchedAt,
  })

  // Synchronize state and trigger history caching when data changes
  useEffect(() => {
    if (listingsData) {
      setListings(listingsData.listings)
      setTotalCount(listingsData.total)
      if (listingsData.subcategoryCounts) {
        setSubcategoryCounts(listingsData.subcategoryCounts)
      }
      if (listingsData.categoryTotal !== undefined) {
        setCategoryTotal(listingsData.categoryTotal)
      }
      if (debouncedQuery.trim().length >= 2) {
        saveSearchToHistory(debouncedQuery)
      }
    }
  }, [listingsData, debouncedQuery, saveSearchToHistory])

  // Update loading state
  useEffect(() => {
    setIsLoading(queryLoading || (queryFetching && listings.length === 0))
  }, [queryLoading, queryFetching, listings.length])

  // Count helper for category items to display in the sidebar/pills
  const getCategoryCount = useCallback(
    (slug: string) => {
      if (slug === 'all') {
        return categories.reduce((sum, c) => sum + (c.verifiedCount || 0), 0)
      }
      return categories.find((c) => c.slug === slug)?.verifiedCount ?? 0
    },
    [categories],
  )

  // Count helper for subcategory items
  const getSubcategoryCount = useCallback(
    (subcatSlug: string) => {
      if (subcatSlug === 'all') {
        return categoryTotal
      }
      return subcategoryCounts[subcatSlug] ?? 0
    },
    [subcategoryCounts, categoryTotal],
  )

  const queryClient = useQueryClient()

  const prefetchNextPage = useCallback(() => {
    const nextPage = page + 1
    const maxPage = Math.ceil(totalCount / 24)
    if (nextPage > maxPage) return

    queryClient.prefetchQuery({
      // Key + params must mirror the live query (incl. price) or the prefetch
      // never matches and pagination refetches anyway.
      queryKey: [
        'listings',
        {
          category: activeCategory,
          subcategory: activeSubcategory,
          district: activeDistrict,
          condition: conditionFilter,
          q: debouncedQuery,
          sort,
          verified: verifiedOnly ? 'true' : 'all',
          price: priceRange,
          page: nextPage,
          customFilters,
        },
      ],
      queryFn: async () => {
        const params = new URLSearchParams()
        if (activeCategory !== 'all') params.set('category', activeCategory)
        if (activeSubcategory !== 'all') params.set('subcategory', activeSubcategory)
        if (activeDistrict !== 'all') params.set('district', activeDistrict)
        if (conditionFilter !== 'all') params.set('condition', conditionFilter)
        if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
        params.set('sort', sort)
        params.set('verified', verifiedOnly ? 'true' : 'all')
        if (priceRange !== 'all') {
          const [mn, mx] = priceRange.split('-')
          if (mn) params.set('priceMin', mn)
          if (mx) params.set('priceMax', mx)
        }

        Object.entries(customFilters).forEach(([key, val]) => {
          if (val && val !== 'all') {
            params.set(`attr_${key}`, val)
          }
        })

        const limit = 24
        const offset = (nextPage - 1) * limit
        params.set('limit', String(limit))
        params.set('offset', String(offset))

        const res = await fetch(`/api/listings?${params.toString()}`)
        if (!res.ok) throw new Error('Failed to fetch listings')
        return res.json()
      },
      staleTime: 60 * 1000,
    })
  }, [
    page,
    totalCount,
    activeCategory,
    activeSubcategory,
    activeDistrict,
    conditionFilter,
    debouncedQuery,
    sort,
    verifiedOnly,
    priceRange,
    customFilters,
    queryClient,
  ])

  const handleOpen = (l: SerializedListing) => {
    setSelected(l)
    setDialogOpen(true)
  }

  const renderCompactRow = useCallback((l: SerializedListing, index: number) => {
    const cover = l.images[0]
    const displayTitle = lang === 'vi' ? (l.titleVi || l.title) : l.title

    return (
      <div
        key={l.id}
        onClick={() => handleOpen(l)}
        className="group flex items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-[#f5f5f5] dark:hover:bg-slate-800/40 cursor-pointer"
      >
        {/* Thumbnail */}
        <div className="relative h-20 w-24 sm:w-28 shrink-0 overflow-hidden rounded-lg bg-[#f1f5f9]">
          {cover ? (
            <Image
              src={cover}
              alt={displayTitle}
              fill
              sizes="112px"
              className="object-cover transition-transform duration-200 group-hover:scale-105"
              priority={index < 4}
              loading={index < 4 ? undefined : 'lazy'}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#f1f5f9]">
              <CategoryIcon name={l.category.icon} className="h-6 w-6 text-slate-300" />
            </div>
          )}
        </div>

        {/* Title + location */}
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-2 sm:line-clamp-1 text-sm font-medium leading-snug text-[#1a202c] dark:text-slate-100 group-hover:underline">
            <Tr text={displayTitle} />
          </h4>
          <div className="mt-1 flex items-center gap-2 text-xs text-[#64748b]">
            <span className="truncate"><Tr text={l.district || l.city} /></span>
            {l.verified && (
              <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-[#0a66c2]">
                <BadgeCheck className="h-3 w-3" />
                {t('card.verified')}
              </span>
            )}
          </div>
        </div>

        {/* Price */}
        <div className="shrink-0 pl-2 text-right">
          <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} className="whitespace-nowrap text-sm font-bold text-[#1a202c] dark:text-white" />
        </div>
      </div>
    )
  }, [lang, handleOpen])

  // Compact card for the narrow map-view list: stacks title → price → location
  // so long prices never crush the title.
  const renderMapCard = useCallback((l: SerializedListing, index: number) => {
    const cover = l.images[0]
    const displayTitle = lang === 'vi' ? (l.titleVi || l.title) : l.title
    return (
      <div
        onClick={() => handleOpen(l)}
        className="group flex gap-3 rounded-xl p-2 text-left transition-colors hover:bg-[#f5f5f5] dark:hover:bg-slate-800/40 cursor-pointer"
      >
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#f1f5f9]">
          {cover ? (
            <Image src={cover} alt={displayTitle} fill sizes="80px" className="object-cover" priority={index < 4} loading={index < 4 ? undefined : 'lazy'} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#f1f5f9]">
              <CategoryIcon name={l.category.icon} className="h-6 w-6 text-slate-300" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-2 text-sm font-medium leading-snug text-[#1a202c] dark:text-slate-100 group-hover:underline">
            <Tr text={displayTitle} />
          </h4>
          <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} className="mt-1 block text-sm font-bold text-[#1a202c] dark:text-white" />
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#64748b]">
            <span className="truncate"><Tr text={l.district || l.city} /></span>
            {l.verified && (
              <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-[#0a66c2]">
                <BadgeCheck className="h-3 w-3" />
                {t('card.verified')}
              </span>
            )}
          </div>
        </div>
        {/* Locate this listing on the map */}
        <button
          onClick={(e) => { e.stopPropagation(); setFocusId(l.id) }}
          aria-label={tr('Show on map', 'Xem trên bản đồ')}
          title={tr('Show on map', 'Xem trên bản đồ')}
          className="shrink-0 self-center flex h-9 w-9 items-center justify-center rounded-full text-[#0a66c2] hover:bg-[#e8f1fb] transition-colors cursor-pointer"
        >
          <MapPin className="h-4 w-4" />
        </button>
      </div>
    )
  }, [lang, t, tr, handleOpen])

  const renderCategorySpecificFilters = () => {
    if (activeCategory === 'all') return null

    const handleSelectChange = (key: string, value: string) => {
      setCustomFilters((prev) => {
        const next = { ...prev }
        if (value === 'all') {
          delete next[key]
        } else {
          next[key] = value
        }
        return next
      })
    }

    if (activeCategory === 'motorbike-rentals') {
      return (
        <>
          {/* Transmission */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100/80">
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
              {tr('Transmission', 'Hộp số')}
            </label>
            <CustomSelect
              value={customFilters.transmission || 'all'}
              onChange={(val) => handleSelectChange('transmission', val)}
              options={[
                { value: 'all', label: tr('All Transmissions', 'Tất cả loại xe') },
                { value: 'automatic', label: tr('Automatic', 'Xe ga (Automatic)') },
                { value: 'manual', label: tr('Manual / Semi-Auto', 'Xe số / Côn tay') },
              ]}
              placeholder={tr('Transmission', 'Hộp số')}
              activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
            />
          </div>

          {/* Engine Capacity */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
              {tr('Engine Size', 'Phân khối')}
            </label>
            <CustomSelect
              value={customFilters.cc || 'all'}
              onChange={(val) => handleSelectChange('cc', val)}
              options={[
                { value: 'all', label: tr('All Capacities', 'Tất cả phân khối') },
                { value: '110-125', label: '110cc - 125cc' },
                { value: '150-up', label: '150cc+' },
              ]}
              placeholder={tr('Engine Size', 'Phân khối')}
              activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
            />
          </div>
        </>
      )
    }

    if (activeCategory === 'house-rentals') {
      return (
        <>
          {/* Bedrooms */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100/80">
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
              {tr('Bedrooms', 'Số phòng ngủ')}
            </label>
            <CustomSelect
              value={customFilters.bedrooms || 'all'}
              onChange={(val) => handleSelectChange('bedrooms', val)}
              options={[
                { value: 'all', label: tr('All Bedrooms', 'Tất cả phòng') },
                { value: '0', label: tr('Studio Room', 'Phòng Studio') },
                { value: '1', label: tr('1 Bedroom', '1 Phòng ngủ') },
                { value: '2', label: tr('2 Bedrooms', '2 Phòng ngủ') },
                { value: '3', label: tr('3+ Bedrooms', '3+ Phòng ngủ') },
              ]}
              placeholder={tr('Bedrooms', 'Số phòng ngủ')}
              activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
            />
          </div>

          {/* Furnishing */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
              {tr('Furnishing', 'Nội thất')}
            </label>
            <CustomSelect
              value={customFilters.furnishing || 'all'}
              onChange={(val) => handleSelectChange('furnishing', val)}
              options={[
                { value: 'all', label: tr('All Furnishings', 'Tất cả trạng thái') },
                { value: 'fully', label: tr('Fully Furnished', 'Đầy đủ nội thất') },
                { value: 'partly', label: tr('Partially / Unfurnished', 'Đồ cơ bản / Trống') },
              ]}
              placeholder={tr('Furnishing', 'Nội thất')}
              activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
            />
          </div>
        </>
      )
    }

    if (activeCategory === 'moving-sale') {
      return (
        <>
          {/* Material */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100/80">
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
              {tr('Material', 'Chất liệu')}
            </label>
            <CustomSelect
              value={customFilters.material || 'all'}
              onChange={(val) => handleSelectChange('material', val)}
              options={[
                { value: 'all', label: tr('All Materials', 'Tất cả chất liệu') },
                { value: 'wood', label: tr('Wood (Oak/Teak)', 'Gỗ tự nhiên (Oak/Teak)') },
                { value: 'fabric', label: tr('Fabric / Cushion', 'Vải bọc / Nệm') },
              ]}
              placeholder={tr('Material', 'Chất liệu')}
              activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
            />
          </div>
        </>
      )
    }

    if (activeCategory === 'electronics') {
      return (
        <>
          {/* Brand */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100/80">
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
              {tr('Brand', 'Thương hiệu')}
            </label>
            <CustomSelect
              value={customFilters.brand || 'all'}
              onChange={(val) => handleSelectChange('brand', val)}
              options={[
                { value: 'all', label: tr('All Brands', 'Tất cả thương hiệu') },
                { value: 'apple', label: 'Apple (iPhone/Mac/iPad)' },
                { value: 'sony', label: 'Sony (Audio/Camera)' },
              ]}
              placeholder={tr('Brand', 'Thương hiệu')}
              activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
            />
          </div>

          {/* Warranty */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
              {tr('Warranty', 'Bảo hành')}
            </label>
            <CustomSelect
              value={customFilters.warranty || 'all'}
              onChange={(val) => handleSelectChange('warranty', val)}
              options={[
                { value: 'all', label: tr('All Warranty', 'Tất cả bảo hành') },
                { value: 'yes', label: tr('Under Active Warranty', 'Còn bảo hành hãng') },
              ]}
              placeholder={tr('Warranty', 'Bảo hành')}
              activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
            />
          </div>
        </>
      )
    }

    if (activeCategory === 'jobs') {
      return (
        <>
          {/* English level */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100/80">
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
              {tr('English Requirement', 'Tiếng Anh')}
            </label>
            <CustomSelect
              value={customFilters.english || 'all'}
              onChange={(val) => handleSelectChange('english', val)}
              options={[
                { value: 'all', label: tr('Any Level', 'Bất kỳ mức độ nào') },
                { value: 'required', label: tr('English Required', 'Yêu cầu tiếng Anh') },
              ]}
              placeholder={tr('English Requirement', 'Tiếng Anh')}
              activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
            />
          </div>
        </>
      )
    }

    return null
  }

  const renderFiltersContent = (isMobile = false) => (
    <div className="space-y-4">
      {/* Categories Selection for Mobile Drawer */}
      {isMobile && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
            {tr('Category', 'Danh mục')}
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => handleCategorySelect('all')}
              className={cn(
                'flex items-center gap-2 rounded-xl border p-2 text-xs font-bold transition-all cursor-pointer justify-center shadow-xs',
                activeCategory === 'all'
                  ? 'bg-accent border-accent-foreground/20 text-accent-foreground shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-[#475569] hover:bg-slate-100'
              )}
            >
              <span className="text-[11px]">{tr('All', 'Tất cả')}</span>
            </button>
            {categories.map((cat) => {
              const isActive = activeCategory === cat.slug
              return (
                <button
                   key={cat.id}
                   onClick={() => handleCategorySelect(cat.slug)}
                   className={cn(
                     'flex items-center gap-2 rounded-xl border p-2 text-xs font-bold transition-all cursor-pointer justify-center min-w-0 shadow-xs',
                     isActive
                       ? 'bg-accent border-accent-foreground/20 text-accent-foreground shadow-sm'
                       : 'bg-slate-50 border-slate-200 text-[#475569] hover:bg-slate-100'
                   )}
                >
                  <CategoryIcon name={cat.icon} className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-[#0a66c2]' : 'text-[#0a66c2]')} />
                  <span className="text-[10px] truncate"><Tr text={lang === 'vi' ? cat.nameVi : cat.name} /></span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Subcategories Selection for Mobile Drawer */}
      {isMobile && activeCategory !== 'all' && SUBCATEGORIES[activeCategory] && (
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-75">
          <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
            {tr('Subcategory', 'Danh mục con')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveSubcategory('all')}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-bold transition-all border cursor-pointer',
                activeSubcategory === 'all'
                  ? 'bg-accent text-accent-foreground border-[#0a66c2]/20 shadow-xs'
                  : 'bg-slate-50 border-slate-200 text-slate-500'
              )}
            >
              {tr('All', 'Tất cả')}
            </button>
            {SUBCATEGORIES[activeCategory].map((sub) => {
              const isSubActive = activeSubcategory === sub.slug
              return (
                <button
                  key={sub.slug}
                  onClick={() => setActiveSubcategory(sub.slug)}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-bold transition-all border cursor-pointer',
                    isSubActive
                      ? 'bg-accent text-accent-foreground border-[#0a66c2]/20 shadow-xs'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  )}
                >
                  <Tr text={lang === 'vi' ? sub.nameVi : sub.name} />
                </button>
              )
            })}
          </div>
        </div>
      )}
      {/* Verified Filter Switch */}
      <div className="flex items-center justify-between py-2.5 bg-white/50 border border-slate-200/60 rounded-xl px-3 shadow-xs select-none">
        <span className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
          {tr('Verified Only', 'Chỉ tin đã xác thực')}
        </span>
        <button
          type="button"
          onClick={() => setVerifiedOnly(!verifiedOnly)}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none focus:ring-2 focus:ring-[#0a66c2] focus:ring-offset-2',
            verifiedOnly ? 'bg-[#0a66c2]' : 'bg-slate-200'
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
              verifiedOnly ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      {/* District Filter */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">
          {tr('District / Commune', 'Quận / Huyện')}
        </label>
        <CustomSelect
          value={activeDistrict}
          onChange={setActiveDistrict}
          options={DISTRICTS.map(d => ({ value: d.slug, label: lang === 'vi' ? d.name : d.nameEn }))}
          placeholder={tr('Select District', 'Chọn Quận / Huyện')}
          activeClassName="bg-accent border-accent-foreground/35 text-accent-foreground"
        />
      </div>

      {/* Condition Filter */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">{t('filter.condition')}</label>
        <div className="flex flex-col gap-1">
          {[
            { slug: 'all', name: tr('All Conditions', 'Tất cả tình trạng') },
            { slug: 'new', name: tr('New / Like New', 'Mới / Like new') },
            { slug: 'used', name: tr('Used / Pre-owned', 'Cũ / Đã dùng') },
          ].map((cond) => (
            <button
              key={cond.slug}
              onClick={() => setConditionFilter(cond.slug)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors cursor-pointer',
                conditionFilter === cond.slug
                  ? 'bg-accent text-accent-foreground'
                  : 'text-[#475569] hover:bg-slate-50',
              )}
            >
              <ChevronRight className={cn('h-3.5 w-3.5', conditionFilter === cond.slug ? 'text-[#0a66c2]' : 'text-[#94a3b8]')} />
              {cond.name}
            </button>
          ))}
        </div>
      </div>

      {/* Category Specific Detailed Filters */}
      {renderCategorySpecificFilters()}
    </div>
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.getElementById('listings-search-input')?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (isLandingMode) {
    return (
      <section ref={listingsRef} id="listings" className="scroll-mt-20 relative overflow-hidden py-5 sm:py-8">
        <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
          
          {/* HERO SEARCH AREA */}
          <div className="pt-4 pb-2 sm:pt-10 text-center">
            <div className="flex flex-col items-center justify-center mb-6">
              <img src="/logo.svg" alt="ENO Logo" className="h-20 w-auto object-contain mb-4 select-none" />
              <p className="eyebrow text-slate-400 dark:text-slate-500">
                {tr("If it's listed, it exists.", 'Đã đăng là có thật.')}
              </p>
            </div>

            {/* Centered Search Bar */}
            <div className="relative max-w-2xl w-full mx-auto select-none">
              {/* One cohesive search pill: search · input · divider · map */}
              <div className="flex items-center rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 transition-all focus-within:border-[#0a66c2] focus-within:ring-2 focus-within:ring-[#0a66c2]/20">
                <button
                  onClick={() => handleLandingSearch(landingQuery)}
                  aria-label={tr('Search', 'Tìm kiếm')}
                  className="shrink-0 pl-4 pr-2 py-3.5 text-[#94a3b8] hover:text-[#0a66c2] transition-colors cursor-pointer"
                >
                  <Search className="h-5 w-5" />
                </button>
                <input
                  id="listings-search-input"
                  value={landingQuery}
                  onChange={(e) => setLandingQuery(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleLandingSearch(landingQuery) }}
                  placeholder={tr('Search motorbikes, apartments, moving sales...', 'Tìm xe máy, căn hộ, đồ thanh lý...')}
                  className="min-w-0 flex-1 bg-transparent py-3.5 pr-3 text-sm text-[#1a202c] dark:text-[#f8fafc] outline-none placeholder:text-[#94a3b8]"
                />
                <span className="h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />
                <button
                  onClick={() => { setViewMode('map'); setShowExplorer(true) }}
                  className="flex shrink-0 items-center gap-1.5 rounded-r-full pl-3.5 pr-4 py-3.5 text-sm font-semibold text-[#0a66c2] hover:text-[#004182] transition-colors cursor-pointer"
                >
                  <Map className="h-4 w-4" />
                  <span>{tr('Map', 'Bản đồ')}</span>
                </button>
              </div>

              {/* Suggestions Overlay in Landing Page */}
              {showSuggestions && (
                <>
                  <div className="fixed inset-0 z-40 cursor-default" onClick={() => setShowSuggestions(false)} />
                  <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-pop text-left max-h-[440px] overflow-y-auto scroll-thin space-y-4">
                    {landingQuery.trim() ? (
                      <>
                        {/* Matching categories */}
                        {matchedCategoriesLanding.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="eyebrow text-slate-400">{tr('Categories', 'Danh mục')}</span>
                            <div className="flex flex-wrap gap-1.5">
                              {matchedCategoriesLanding.map((cat) => (
                                <button
                                  key={cat.id}
                                  onClick={() => { handleCategorySelect(cat.slug); setLandingQuery(''); setShowSuggestions(false) }}
                                  className="flex items-center gap-1.5 rounded-full bg-[#e8f1fb] px-3 py-1.5 text-xs font-semibold text-[#0a66c2] hover:bg-[#0a66c2] hover:text-white transition-colors cursor-pointer"
                                >
                                  <CategoryIcon name={cat.icon} className="h-3 w-3" />
                                  <span><Tr text={lang === 'vi' ? cat.nameVi : cat.name} /></span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Instant matches */}
                        <div className="space-y-1.5">
                          <span className="eyebrow text-slate-400">{tr('Instant matches', 'Kết quả nhanh')}</span>
                          {landingMatches.length === 0 ? (
                            <p className="py-3 text-center text-xs text-[#94a3b8] italic">
                              {tr('No matches. Press Enter to search.', 'Không tìm thấy. Nhấn Enter để tìm rộng hơn.')}
                            </p>
                          ) : (
                            <div className="space-y-0.5">
                              {landingMatches.map((l) => (
                                <button
                                  key={l.id}
                                  onClick={() => { handleOpen(l); setShowSuggestions(false) }}
                                  className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left hover:bg-[#f1f5f9] transition-colors cursor-pointer"
                                >
                                  <div className="relative h-10 w-12 shrink-0 overflow-hidden rounded-lg bg-[#f1f5f9]">
                                    {l.images[0] && <Image src={l.images[0]} alt="" fill sizes="48px" className="object-cover" />}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <h5 className="truncate text-xs font-semibold text-[#1a202c]"><Tr text={lang === 'vi' ? (l.titleVi || l.title) : l.title} /></h5>
                                    <span className="text-[10px] text-slate-400"><Tr text={lang === 'vi' ? l.category.nameVi : l.category.name} /></span>
                                  </div>
                                  <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} className="shrink-0 text-xs font-bold text-[#1a202c]" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Recent searches */}
                        {recentSearches.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="eyebrow flex items-center gap-1 text-slate-400"><Clock className="h-3 w-3" />{tr('Recent', 'Tìm gần đây')}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); localStorage.removeItem('eno:recent_searches'); setRecentSearches([]) }}
                                className="text-[10px] font-semibold text-slate-400 hover:text-red-500 cursor-pointer"
                              >
                                {tr('Clear', 'Xóa')}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {recentSearches.map((term, i) => (
                                <button
                                  key={i}
                                  onClick={() => { setLandingQuery(term); handleLandingSearch(term) }}
                                  className="rounded-full bg-[#f1f5f9] px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2] transition-colors cursor-pointer"
                                >
                                  {term}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Popular searches */}
                        <div className="space-y-1.5">
                          <span className="eyebrow text-slate-400">{tr('Popular searches', 'Từ khóa phổ biến')}</span>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { label: 'Honda SH', labelVi: 'Xe SH' },
                              { label: 'Studio Apartment', labelVi: 'Căn hộ Studio', query: 'Studio' },
                              { label: 'Sofa', labelVi: 'Ghế Sofa' },
                              { label: 'Sony Camera', labelVi: 'Máy ảnh Sony', query: 'Sony' },
                            ].map((item, i) => {
                              const termQuery = item.query || item.label
                              return (
                                <button
                                  key={i}
                                  onClick={() => { setLandingQuery(termQuery); handleLandingSearch(termQuery) }}
                                  className="rounded-full bg-[#f1f5f9] px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2] transition-colors cursor-pointer"
                                >
                                  {lang === 'vi' ? item.labelVi : item.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        {/* Popular areas */}
                        <div className="space-y-1.5">
                          <span className="eyebrow text-slate-400">{tr('Popular areas', 'Khu vực phổ biến')}</span>
                          <div className="flex flex-wrap gap-1.5">
                            {DISTRICTS.filter((d) => d.slug !== 'all').slice(0, 5).map((d) => (
                              <button
                                key={d.slug}
                                onClick={() => { setActiveDistrict(d.slug); setShowExplorer(true); setShowSuggestions(false) }}
                                className="flex items-center gap-1.5 rounded-full bg-[#f1f5f9] px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2] transition-colors cursor-pointer"
                              >
                                <MapPin className="h-3 w-3" />
                                {lang === 'vi' ? d.name : d.nameEn}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* FINN-STYLE CATEGORY GRID */}
          <div className="space-y-4">
            <h2 className="eyebrow text-slate-400 dark:text-slate-500 text-center select-none">
              {tr('Browse by Category', 'Khám phá danh mục')}
            </h2>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
              {categories.map((cat) => {
                const cc = CATEGORY_COLOR_CLASSES[cat.color] ?? CATEGORY_COLOR_CLASSES.brand
                const hex = cc.text.match(/#[0-9a-fA-F]{6}/)?.[0] ?? '#0a66c2'
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategorySelect(cat.slug)}
                    style={{ '--cat': hex } as CSSProperties}
                    className="group flex flex-col items-center justify-center gap-2.5 p-4 text-center cursor-pointer"
                  >
                    <CategoryIcon
                      name={cat.icon}
                      className="h-8 w-8 text-slate-400 dark:text-slate-500 transition-all duration-200 group-hover:scale-110 group-hover:text-[var(--cat)]"
                    />
                    <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 leading-tight transition-colors group-hover:text-[var(--cat)]">
                      <Tr text={lang === 'vi' ? cat.nameVi : cat.name} />
                    </span>
                    <span className="text-[10px] text-slate-400 select-none font-semibold">
                      {cat.verifiedCount || 0} {tr('listings', 'tin')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* CURATED BROWSE ROWS (Airbnb-style horizontal carousels) */}
          {listings.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#cbd5e1] bg-white/60 py-16 text-center">
              <Inbox className="h-10 w-10 text-[#cbd5e1]" />
              <p className="text-sm font-semibold text-[#475569]">
                {tr('No listings found.', 'Không có tin đăng nào.')}
              </p>
            </div>
          ) : (
            <div className="space-y-10">
              <CardRow
                title={tr('Recommendations for you', 'Gợi ý dành cho bạn')}
                listings={listings.slice(0, 12)}
                onOpen={handleOpen}
                onViewAll={() => setShowExplorer(true)}
                viewAllLabel={tr('View all', 'Xem tất cả')}
              />
              {categories.map((cat) => {
                const items = listings.filter((l) => l.category.slug === cat.slug)
                if (items.length === 0) return null
                return (
                  <CardRow
                    key={cat.id}
                    title={<Tr text={lang === 'vi' ? cat.nameVi : cat.name} />}
                    listings={items}
                    onOpen={handleOpen}
                    onViewAll={() => handleCategorySelect(cat.slug)}
                    viewAllLabel={tr('View all', 'Xem tất cả')}
                  />
                )
              })}
            </div>
          )}

        </div>
        {/* Same shared dialog as the explorer return (landing/explorer are
            mutually-exclusive returns, so only one mounts) — identical props. */}
        <ListingDetailDialog
          listing={selected}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onLocate={(l) => { setDialogOpen(false); setShowExplorer(true); setViewMode('map'); setFocusId(l.id) }}
        />
      </section>
    )
  }

  // Compact, category-aware facet bar (faceted-search pattern) — replaces the
  // always-on sidebar. Only the facets relevant to the active category show.
  const renderFacetBar = () => {
    const setFacet = (key: string, value: string) =>
      setCustomFilters((prev) => {
        const n = { ...prev }
        if (value === 'all') delete n[key]
        else n[key] = value
        return n
      })

    const cls = ''
    const active = 'bg-[#e8f1fb] text-[#0a66c2]'
    // Content-sized pills (no fixed min-width) so they pack into one swipable
    // row on mobile; widen a touch on desktop where they wrap.
    const wrap = 'w-auto shrink-0 lg:min-w-[7.5rem]'

    const Facet = (key: string, placeholder: string, options: { value: string; label: string }[]) => (
      <CustomSelect
        key={key}
        value={customFilters[key] || 'all'}
        onChange={(v) => setFacet(key, v)}
        options={[{ value: 'all', label: tr('All', 'Tất cả') }, ...options]}
        placeholder={placeholder}
        className={cls}
        activeClassName={active}
        wrapperClassName={wrap}
      />
    )

    // Category-aware price brackets (VND; empty max = open-ended).
    const priceOpts: { value: string; label: string }[] =
      activeCategory === 'house-rentals'
        ? [
            { value: '0-10000000', label: tr('Under ₫10M', 'Dưới 10tr') },
            { value: '10000000-20000000', label: '10–20tr' },
            { value: '20000000-40000000', label: '20–40tr' },
            { value: '40000000-', label: tr('₫40M+', 'Trên 40tr') },
          ]
        : activeCategory === 'motorbike-rentals'
        ? [
            { value: '0-2000000', label: tr('Under ₫2M', 'Dưới 2tr') },
            { value: '2000000-4000000', label: '2–4tr' },
            { value: '4000000-', label: tr('₫4M+', 'Trên 4tr') },
          ]
        : activeCategory === 'services' || activeCategory === 'jobs'
        ? [
            { value: '0-500000', label: tr('Under ₫500k', 'Dưới 500k') },
            { value: '500000-2000000', label: '500k–2tr' },
            { value: '2000000-', label: tr('₫2M+', 'Trên 2tr') },
          ]
        : activeCategory === 'electronics' || activeCategory === 'moving-sale'
        ? [
            { value: '0-5000000', label: tr('Under ₫5M', 'Dưới 5tr') },
            { value: '5000000-15000000', label: '5–15tr' },
            { value: '15000000-30000000', label: '15–30tr' },
            { value: '30000000-', label: tr('₫30M+', 'Trên 30tr') },
          ]
        : [
            { value: '0-1000000', label: tr('Under ₫1M', 'Dưới 1tr') },
            { value: '1000000-10000000', label: '1–10tr' },
            { value: '10000000-30000000', label: '10–30tr' },
            { value: '30000000-', label: tr('₫30M+', 'Trên 30tr') },
          ]

    const facets: React.ReactNode[] = [
      <CustomSelect
        key="district"
        value={activeDistrict}
        onChange={setActiveDistrict}
        options={DISTRICTS.map((d) => ({ value: d.slug, label: lang === 'vi' ? d.name : d.nameEn }))}
        placeholder={tr('Area', 'Khu vực')}
        className={cls}
        activeClassName={active}
        wrapperClassName={wrap}
        icon={<MapPin className="h-3.5 w-3.5 text-[#94a3b8]" />}
      />,
      <CustomSelect
        key="price"
        value={priceRange}
        onChange={setPriceRange}
        options={[{ value: 'all', label: tr('Any price', 'Mọi giá') }, ...priceOpts]}
        placeholder={tr('Price', 'Giá')}
        className={cls}
        activeClassName={active}
        wrapperClassName={wrap}
      />,
    ]

    if (activeCategory === 'motorbike-rentals') {
      facets.push(Facet('transmission', tr('Transmission', 'Hộp số'), [
        { value: 'automatic', label: tr('Automatic', 'Xe ga') },
        { value: 'manual', label: tr('Manual', 'Xe số') },
      ]))
      facets.push(Facet('cc', tr('Engine', 'Phân khối'), [
        { value: '110-125', label: '110–125cc' },
        { value: '150-up', label: '150cc+' },
      ]))
    } else if (activeCategory === 'house-rentals') {
      facets.push(Facet('bedrooms', tr('Bedrooms', 'Phòng ngủ'), [
        { value: '0', label: 'Studio' },
        { value: '1', label: '1 BR' },
        { value: '2', label: '2 BR' },
        { value: '3', label: '3+ BR' },
      ]))
      facets.push(Facet('furnishing', tr('Furnishing', 'Nội thất'), [
        { value: 'fully', label: tr('Furnished', 'Đầy đủ') },
        { value: 'partly', label: tr('Unfurnished', 'Cơ bản') },
      ]))
    } else if (activeCategory === 'moving-sale') {
      facets.push(Facet('material', tr('Material', 'Chất liệu'), [
        { value: 'wood', label: tr('Wood', 'Gỗ') },
        { value: 'fabric', label: tr('Fabric', 'Vải') },
      ]))
    } else if (activeCategory === 'electronics') {
      facets.push(Facet('brand', tr('Brand', 'Hãng'), [
        { value: 'apple', label: 'Apple' },
        { value: 'sony', label: 'Sony' },
      ]))
      facets.push(Facet('warranty', tr('Warranty', 'Bảo hành'), [
        { value: 'yes', label: tr('In warranty', 'Còn BH') },
      ]))
    } else if (activeCategory === 'jobs') {
      facets.push(Facet('english', tr('English', 'Tiếng Anh'), [
        { value: 'required', label: tr('Required', 'Yêu cầu') },
      ]))
    }

    // Condition is only meaningful for physical goods.
    if (activeCategory === 'electronics' || activeCategory === 'moving-sale') {
      facets.push(
        <CustomSelect
          key="condition"
          value={conditionFilter}
          onChange={setConditionFilter}
          options={[
            { value: 'all', label: tr('Condition', 'Tình trạng') },
            { value: 'new', label: tr('New', 'Mới') },
            { value: 'used', label: tr('Used', 'Đã dùng') },
          ]}
          placeholder={tr('Condition', 'Tình trạng')}
          className={cls}
          activeClassName={active}
          wrapperClassName={wrap}
        />,
      )
    }

    const hasActive =
      activeDistrict !== 'all' || conditionFilter !== 'all' || priceRange !== 'all' || Object.keys(customFilters).length > 0 || !verifiedOnly

    return (
      // Mobile: one horizontally-swipable line (bleeds to screen edges); desktop: wraps.
      <div className="flex items-center gap-2 flex-nowrap overflow-x-auto scrollbar-none -mx-4 px-4 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-x-visible">
        {facets}
        {/* Static trust indicator — every listing on ENO is verified (not a toggle). */}
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#e8f1fb] px-3.5 py-2 text-sm font-semibold text-[#0a66c2]">
          <ShieldCheck className="h-3.5 w-3.5" />
          {tr('Verified only', 'Chỉ tin đã xác minh')}
        </span>
        {hasActive && (
          <button
            onClick={() => {
              setActiveDistrict('all')
              setConditionFilter('all')
              setPriceRange('all')
              setCustomFilters({})
              setVerifiedOnly(true)
            }}
            className="shrink-0 px-1 text-xs font-semibold text-[#0a66c2] hover:underline cursor-pointer"
          >
            {tr('Clear', 'Xóa lọc')}
          </button>
        )}
      </div>
    )
  }

  // Empty state that diagnoses WHY there are no results and offers one-tap relaxation.
  const renderEmptyState = () => {
    const chips: { label: string; onClear: () => void }[] = []
    if (debouncedQuery.trim()) chips.push({ label: `"${debouncedQuery.trim()}"`, onClear: () => setQuery('') })
    if (activeSubcategory !== 'all') {
      const sub = SUBCATEGORIES[activeCategory]?.find((s) => s.slug === activeSubcategory)
      chips.push({ label: sub ? (lang === 'vi' ? sub.nameVi : sub.name) : activeSubcategory, onClear: () => setActiveSubcategory('all') })
    }
    if (activeDistrict !== 'all') {
      const d = DISTRICTS.find((x) => x.slug === activeDistrict)
      chips.push({ label: d ? (lang === 'vi' ? d.name : d.nameEn) : activeDistrict, onClear: () => setActiveDistrict('all') })
    }
    if (priceRange !== 'all') chips.push({ label: tr('Price range', 'Khoảng giá'), onClear: () => setPriceRange('all') })
    if (conditionFilter !== 'all') chips.push({ label: conditionFilter === 'new' ? tr('New', 'Mới') : tr('Used', 'Đã dùng'), onClear: () => setConditionFilter('all') })
    Object.entries(customFilters).forEach(([k, v]) =>
      chips.push({ label: `${k}: ${v}`, onClear: () => setCustomFilters((prev) => { const n = { ...prev }; delete n[k]; return n }) }),
    )

    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[#cbd5e1] py-14 px-6 text-center">
        <Inbox className="h-10 w-10 text-[#cbd5e1]" />
        <p className="text-sm font-semibold text-[#475569]">
          {tr('No listings match these filters.', 'Không có tin nào khớp với bộ lọc này.')}
        </p>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-[#94a3b8]">{tr('Remove:', 'Bỏ bớt:')}</span>
            {chips.map((c, i) => (
              <button
                key={i}
                onClick={c.onClear}
                className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2] transition-colors cursor-pointer"
              >
                {c.label}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {chips.length > 0 && (
            <button
              onClick={() => {
                setQuery('')
                setActiveSubcategory('all')
                setActiveDistrict('all')
                setPriceRange('all')
                setConditionFilter('all')
                setCustomFilters({})
                setVerifiedOnly(true)
              }}
              className="rounded-full bg-[#0a66c2] px-4 py-2 text-xs font-bold text-white hover:bg-[#004182] transition-colors cursor-pointer"
            >
              {tr('Clear all filters', 'Xóa tất cả bộ lọc')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <section ref={listingsRef} id="listings" className="scroll-mt-20 relative overflow-hidden py-5 sm:py-8">
      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">

        {/* Single-column faceted directory */}
        <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">

          {/* Listings Main Workspace */}
          <div className="space-y-4">

            {/* Back to Home Breadcrumb in Explorer Mode */}
            <div className="flex items-center justify-between px-1">
              <button
                onClick={resetToLandingPage}
                className="text-xs font-bold text-[#0a66c2] dark:text-[#90caf9] hover:underline flex items-center gap-1 cursor-pointer select-none"
              >
                &larr; {tr('Back to Home', 'Quay lại Trang chủ')}
              </button>
            </div>

            
            {/* Top Categories Navigation Bar (Desktop Hover Dropdowns / Mobile Click Dropdowns) */}
            <div className="relative select-none">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 lg:flex-wrap lg:overflow-x-visible">
                {/* All Categories Pill */}
                <div className="relative group shrink-0 lg:shrink">
                  <button
                    onClick={() => handleCategoryClick('all')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer select-none whitespace-nowrap',
                      activeCategory === 'all'
                        ? 'bg-[#0a66c2] text-white'
                        : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2]'
                    )}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>{tr('All Categories', 'Tất cả danh mục')}</span>
                  </button>
                </div>

                {/* Categories Pills — selection only; subcategories live in the chip row below */}
                {categories.map((cat) => {
                  const isActive = activeCategory === cat.slug
                  return (
                    <button
                      key={cat.id}
                      onClick={() => handleCategoryClick(cat.slug)}
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer select-none whitespace-nowrap',
                        isActive
                          ? 'bg-[#0a66c2] text-white'
                          : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2]'
                      )}
                    >
                      <CategoryIcon name={cat.icon} className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-white' : 'text-[#0a66c2]')} />
                      <span><Tr text={lang === 'vi' ? cat.nameVi : cat.name} /></span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Subcategory quick-chips — fast drill-down, revealed only once a category is active (progressive disclosure) */}
            <>
              {activeCategory !== 'all' && SUBCATEGORIES[activeCategory]?.length > 0 && (
                <div
                  key={activeCategory}
                  className="overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200"
                >
                  <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1 pt-0.5">
                    <button
                      onClick={() => setActiveSubcategory('all')}
                      className={cn(
                        'shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap',
                        activeSubcategory === 'all'
                          ? 'bg-[#0a66c2] text-white'
                          : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2]'
                      )}
                    >
                      {tr('All', 'Tất cả')}
                    </button>
                    {SUBCATEGORIES[activeCategory].map((sub) => {
                      const isActive = activeSubcategory === sub.slug
                      const count = subcategoryCounts[sub.slug]
                      return (
                        <button
                          key={sub.slug}
                          onClick={() => setActiveSubcategory(sub.slug)}
                          className={cn(
                            'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap',
                            isActive
                              ? 'bg-[#0a66c2] text-white'
                              : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2]'
                          )}
                        >
                          <span><Tr text={lang === 'vi' ? sub.nameVi : sub.name} /></span>
                          {count != null && (
                            <span className={cn('text-[10px] font-semibold', isActive ? 'text-white/70' : 'text-[#94a3b8]')}>
                              {count}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>

            {/* Category-aware facet bar (replaces the old sidebar) */}
            {renderFacetBar()}

            {/* Quick Search & Sort Control Bar */}
            <div className="flex flex-col sm:flex-row gap-2.5 items-center justify-between">
              {/* Search Box */}
              <div className="relative w-full sm:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
                <input
                  id="listings-search-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder={tr('Search keyword (Sofa, Motorbike, Room...)', 'Nhập từ khóa (Sofa, AirBlade, Thảo Điền...)')}
                  className="w-full rounded-full bg-[#f1f5f9] py-2.5 pl-10 pr-3 text-sm text-[#1a202c] outline-none transition-all placeholder:text-[#94a3b8] focus:bg-white focus:ring-2 focus:ring-[#0a66c2]/20"
                />

                {showSuggestions && (
                  <>
                    {/* Backdrop to close suggestions when clicking outside */}
                    <div 
                      className="fixed inset-0 z-40 cursor-default" 
                      onClick={() => setShowSuggestions(false)} 
                    />

                    {/* Suggestions Dropdown overlay */}
                    <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-100 max-h-[380px] overflow-y-auto scroll-thin">
                      
                      {/* 1. Category Suggestions */}
                      {matchedCategories.length > 0 && (
                        <div className="mb-3 space-y-1.5">
                          <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider select-none">
                            {tr('Matching Categories', 'Danh mục phù hợp')}
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {matchedCategories.map(cat => (
                              <button
                                key={cat.id}
                                onClick={() => {
                                  handleCategorySelect(cat.slug)
                                  setQuery('')
                                  setShowSuggestions(false)
                                }}
                                className="flex items-center gap-1.5 rounded-full bg-[#e8f1fb] px-3 py-1.5 text-xs font-semibold text-[#0a66c2] hover:bg-[#0a66c2] hover:text-white transition-colors cursor-pointer"
                              >
                                <CategoryIcon name={cat.icon} className="h-3 w-3" />
                                <span><Tr text={lang === 'vi' ? cat.nameVi : cat.name} /></span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 2. Direct Matches (Autocomplete Products) */}
                      {query.trim().length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider select-none">
                            {tr('Instant Matches', 'Xem nhanh tin đăng')}
                          </span>
                          {listings.length === 0 ? (
                            <div className="py-4 text-center text-xs text-[#94a3b8] italic">
                              {tr('No matches found', 'Không tìm thấy kết quả phù hợp')}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {listings.slice(0, 4).map((l) => {
                                const displayTitle = lang === 'vi' ? (l.titleVi || l.title) : l.title
                                return (
                                  <div
                                    key={l.id}
                                    onClick={() => {
                                      handleOpen(l)
                                      saveSearchToHistory(query)
                                      setShowSuggestions(false)
                                    }}
                                    className="flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-slate-50 transition-colors cursor-pointer group/item border border-transparent hover:border-slate-100"
                                  >
                                    <div className="relative h-10 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-[#f1f5f9]">
                                      {l.images[0] ? (
                                        <Image src={l.images[0]} alt={displayTitle} fill sizes="48px" className="object-cover" />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-slate-200">
                                          <Search className="h-4 w-4 text-slate-400" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <h5 className="truncate text-xs font-bold text-[#1a202c] group-hover/item:text-[#0a66c2] leading-tight">
                                        {displayTitle}
                                      </h5>
                                      <span className="text-[10px] text-slate-400">
                                        <Tr text={lang === 'vi' ? l.category.nameVi : l.category.name} />
                                      </span>
                                    </div>
                                    <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} className="text-xs font-extrabold text-[#0a66c2] shrink-0" />
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 3. Empty Search Suggestions (History & Popular) */}
                      {query.trim().length === 0 && (
                        <div className="space-y-4">
                          {/* Recent Searches */}
                          {recentSearches.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between select-none">
                                <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {tr('Recent Searches', 'Tìm kiếm gần đây')}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    localStorage.removeItem('eno:recent_searches')
                                    setRecentSearches([])
                                  }}
                                  className="text-[10px] font-semibold text-slate-400 hover:text-red-500 cursor-pointer"
                                >
                                  {tr('Clear History', 'Xóa lịch sử')}
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {recentSearches.map((term, i) => (
                                  <button
                                    key={i}
                                    onClick={() => {
                                      setQuery(term)
                                      setShowSuggestions(false)
                                    }}
                                    className="rounded-full bg-[#f1f5f9] px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2] transition-colors cursor-pointer"
                                  >
                                    {term}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Curated Popular Searches */}
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider select-none">
                              {tr('Popular Searches', 'Gợi ý từ khóa phổ biến')}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {[
                                { label: 'Honda SH', labelVi: 'Xe SH' },
                                { label: 'Studio Apartment', labelVi: 'Căn hộ Studio', query: 'Studio' },
                                { label: 'Sofa', labelVi: 'Ghế Sofa' },
                                { label: 'Sony Camera', labelVi: 'Máy ảnh Sony', query: 'Sony' },
                                { label: 'Room in Thao Dien', labelVi: 'Phòng Thảo Điền', query: 'Thao Dien' }
                              ].map((item, i) => {
                                const term = lang === 'vi' ? item.labelVi : item.label
                                const termQuery = item.query || item.label
                                return (
                                  <button
                                    key={i}
                                    onClick={() => {
                                      setQuery(termQuery)
                                      setShowSuggestions(false)
                                    }}
                                    className="rounded-full bg-[#f1f5f9] px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2] transition-colors cursor-pointer"
                                  >
                                    {term}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Sorting & Views */}
              <div className="flex items-center justify-between sm:justify-end gap-2.5 w-full sm:w-auto">
                <CustomSelect
                  value={sort}
                  onChange={(val) => setSort(val as SortKey)}
                  options={[
                    { value: 'newest', label: tr('Newest', 'Mới đăng') },
                    { value: 'verified-first', label: tr('Verified first', 'Đã xác minh trước') },
                    { value: 'price-low', label: tr('Price: Low to High', 'Giá: thấp-cao') },
                    { value: 'price-high', label: tr('Price: High to Low', 'Giá: cao-thấp') },
                    { value: 'popular', label: tr('Popular', 'Xem nhiều') },
                  ]}
                  placeholder={tr('Sort', 'Sắp xếp')}
                  className="py-2 pl-3 pr-2.5 w-44 font-semibold border-slate-200 text-[#334155]"
                  activeClassName="border-[#0a66c2]"
                  icon={<SlidersHorizontal className="h-3.5 w-3.5 text-[#94a3b8] shrink-0" />}
                />

                {/* Grid vs List vs Map view toggle */}
                  <button
                    onClick={() => setViewMode('compact')}
                    aria-label={tr('List view', 'Danh sách')}
                    aria-pressed={viewMode === 'compact'}
                    title={tr('List view', 'Danh sách')}
                    className={cn(
                      'rounded-lg p-2 transition-colors cursor-pointer',
                      viewMode === 'compact' ? 'bg-accent text-accent-foreground' : 'text-slate-400',
                    )}
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    aria-label={tr('Grid view', 'Lưới')}
                    aria-pressed={viewMode === 'grid'}
                    title={tr('Grid view', 'Lưới')}
                    className={cn(
                      'rounded-lg p-2 transition-colors cursor-pointer',
                      viewMode === 'grid' ? 'bg-accent text-accent-foreground' : 'text-slate-400',
                    )}
                  >
                    <Grid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode('map')}
                    aria-label={tr('Map view', 'Bản đồ')}
                    aria-pressed={viewMode === 'map'}
                    title={tr('Map view', 'Xem Bản đồ')}
                    className={cn(
                      'rounded-lg p-2 transition-colors cursor-pointer',
                      viewMode === 'map' ? 'bg-accent text-accent-foreground' : 'text-slate-400',
                    )}
                  >
                    <Map className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

            {/* Results metadata count */}
            <div className="flex items-center justify-between text-xs text-[#64748b] px-1 select-none">
              <span>
                {tr('Found', 'Tìm thấy')}{' '}
                <strong className="text-[#1a202c]">{totalCount}</strong>{' '}
                {tr('listings', 'tin đăng')}
              </span>
            </div>

            {/* LISTINGS CONTAINER */}
            {isLoading && listings.length === 0 && (
              viewMode === 'grid' ? (
                <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-3">
                      <div className="aspect-[4/3] w-full rounded-xl shimmer" />
                      <div className="h-4 w-2/3 rounded shimmer" />
                      <div className="h-3 w-1/2 rounded shimmer" />
                      <div className="h-3 w-1/3 rounded shimmer" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <div className="h-16 w-20 shrink-0 rounded-lg shimmer" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-1/2 rounded shimmer" />
                        <div className="h-3 w-1/3 rounded shimmer" />
                      </div>
                      <div className="h-8 w-24 rounded shimmer mr-2" />
                    </div>
                  ))}
                </div>
              )
            )}

            {!isLoading && listings.length === 0 && renderEmptyState()}

            {listings.length > 0 && (
              <div className={cn(isLoading && 'opacity-60 pointer-events-none transition-opacity')}>
                <div
                  key={`${viewMode}|${activeCategory}|${activeSubcategory}|${activeDistrict}|${sort}|${verifiedOnly}|${conditionFilter}`}
                  className="animate-in fade-in slide-in-from-bottom-1 duration-200"
                >
                {viewMode === 'grid' && (
                  /* Grid Mode (Standard Cards) */
                  <div className="grid grid-cols-2 gap-2 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {listings.map((l, index) => (
                      <div
                        key={l.id}
                        className="flex flex-col h-full"
                        style={{ contentVisibility: 'auto' as any, containIntrinsicSize: 'auto 320px' }}
                      >
                        <ListingCard listing={l} onOpen={handleOpen} priority={index < 4} />
                      </div>
                    ))}
                  </div>
                )}

                {viewMode === 'map' && (
                  /* Airbnb-style split: scrollable list (left) + sticky map (right) */
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Left: scrollable result list */}
                    <div className="min-w-0 lg:col-span-5 lg:h-[640px] lg:overflow-y-auto lg:pr-1 space-y-1 scroll-thin order-2 lg:order-1">
                      {listings.map((l, index) => (
                        <div
                          key={l.id}
                          onMouseEnter={() => setHoveredId(l.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          className={cn(
                            'rounded-xl transition-shadow',
                            hoveredId === l.id && 'ring-2 ring-inset ring-[#0a66c2]/40',
                          )}
                        >
                          {renderMapCard(l, index)}
                        </div>
                      ))}
                    </div>
                    {/* Right: sticky map */}
                    <div className="min-w-0 lg:col-span-7 h-[420px] lg:h-[640px] lg:sticky lg:top-24 rounded-2xl overflow-hidden order-1 lg:order-2">
                      <ListingsMap
                        listings={listings}
                        activeDistrict={activeDistrict}
                        onOpenListing={handleOpen}
                        lang={lang}
                        selectedId={hoveredId ?? focusId}
                        onHover={setHoveredId}
                        focusId={focusId}
                      />
                    </div>
                  </div>
                )}

                {viewMode === 'compact' && (
                  /* Compact Row Mode (bonbanh-style list rows) */
                  <div className="space-y-1.5">
                    {listings.map((l, index) => (
                      <div
                        key={l.id}
                        style={{ contentVisibility: 'auto' as any, containIntrinsicSize: 'auto 90px' }}
                      >
                        {renderCompactRow(l, index)}
                      </div>
                    ))}
                  </div>
                )}
                </div>

                {/* Pagination Controls */}
                {Math.ceil(totalCount / 24) > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-100 pt-5 mt-6 select-none">
                    <button
                      disabled={page <= 1 || isLoading}
                      onClick={() => setPage((p) => Math.max(p - 1, 1))}
                      className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#475569] shadow-sm transition-all hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                    >
                      &larr; {tr('Previous', 'Trang trước')}
                    </button>

                    <span className="text-xs font-semibold text-[#64748b]">
                      {tr('Page', 'Trang')} {page} / {Math.ceil(totalCount / 24)}
                    </span>

                    <button
                      disabled={page >= Math.ceil(totalCount / 24) || isLoading}
                      onClick={() => setPage((p) => Math.min(p + 1, Math.ceil(totalCount / 24)))}
                      onMouseEnter={prefetchNextPage}
                      className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#475569] shadow-sm transition-all hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                    >
                      {tr('Next', 'Trang sau')} &rarr;
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MOBILE BOTTOM SLIDE-UP DRAWER OVERLAY */}
      {isMobileFilterOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-5 shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b pb-2.5">
              <h4 className="text-sm font-extrabold text-[#034078]">
                {tr('Search Filters', 'Bộ lọc tìm kiếm')}
              </h4>
              <button
                onClick={() => setIsMobileFilterOpen(false)}
                className="rounded-full bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            {/* Scrollable Filters */}
            <div className="max-h-[50vh] overflow-y-auto pr-1">
              {renderFiltersContent(true)}
            </div>

            {/* Apply Action Button */}
            <button
              onClick={() => setIsMobileFilterOpen(false)}
              className="w-full rounded-xl bg-[#0a66c2] py-2.5 text-xs font-bold text-white shadow-md active:scale-98 cursor-pointer"
            >
              {tr('Apply Filters', 'Áp dụng lọc')} ({totalCount} {tr('listings', 'tin')})
            </button>
          </div>
        </div>
      )}

      {/* Single shared detail dialog for ALL view modes (grid/compact/map) and
          page states, so every card opens the identical detail with a clickable
          "view on map" address. */}
      <ListingDetailDialog
        listing={selected}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onLocate={(l) => { setDialogOpen(false); setShowExplorer(true); setViewMode('map'); setFocusId(l.id) }}
      />
    </section>
  )
}
