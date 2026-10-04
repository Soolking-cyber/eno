'use client'

// The header on teacher.<base> (2026-09-30). ⛔ NO SIGN-IN HERE: cookies are host-scoped and the
// auth callback is not registered for this host, so a sign-in started here could never finish
// (Opus, commit gate 09-30). The site header's search, bell and account controls would all write
// from a non-canonical origin too. So: the mark, linking home, and a way to an existing profile.
import { useLanguage } from '@/context/language-context'

export function TeacherHostHeader({ apexOrigin }: { apexOrigin: string }) {
  const { tr } = useLanguage()
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-3 py-4 sm:px-6 lg:px-8">
      <a href={apexOrigin || '/'} aria-label={tr('Home', 'Trang chủ', 'page')}>
        <img src="/logo-mark.svg" alt="" width={40} height={40} className="size-10" />
      </a>
      <a href={`${apexOrigin}/teachers/edit`} className="text-sm font-semibold text-brand hover:underline">
        {tr('Already have a profile? Sign in', 'Đã có hồ sơ? Đăng nhập')}
      </a>
    </header>
  )
}
