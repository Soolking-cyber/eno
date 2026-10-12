'use client'

import { ArrowRight, GraduationCap } from '@/components/ui/icons'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { localizedHref } from '@/lib/lang-pinned'

/**
 * ⛔ THE WAY IN FOR A TEACHER WHO CAME TO POST (owner, 2026-10-12: "someone created a job post as a teacher profile which
 * is our mistake so we have to mitigate it wont happen again"). Two doors, both on /teachers/join on THIS host — the
 * poster is signed in here, and that form resumes a saved draft and sends someone who already has a profile to theirs
 * (the home rail keeps the teacher.eno.vn host link, where the owner asked for it):
 *
 *  · TeacherProfileInstead — on Jobs + "Looking for work", the intent a teacher picks when they meant the teacher form.
 *    On Teaching it HOLDS Publish and says why (the server refuses the pair too: taxonomy.ts TEACHER_SEEKING_POST); on
 *    every other Jobs aisle it is a pointer only — a barista looking for shifts posts here as before.
 *    `id="pw-teacher"`: the "Still needed" list and the server's refusal jump here (post-wizard.tsx scrollToField).
 *  · TeacherProfileLine — one line under the category grid, for a teacher who has not picked anything yet.
 *
 * The copy is the schools sidebar's (schools-sidebar.tsx), so the promise is the one made everywhere: schools message
 * you, and your contact stays private until you share it (teacher-contact.tsx — the teacher's own "Share my contact").
 * ⚠️ ENGLISH IN LITERAL tr() PAIRS: scripts/gen-ui-strings.mjs pre-translates only literals.
 */
export function TeacherProfileInstead({ blocking }: { blocking: boolean }) {
  const { lang, tr } = useLanguage()
  return (
    <Alert
      id="pw-teacher"
      // A hold is announced as it appears; the pointer is not urgent.
      role={blocking ? 'alert' : 'note'}
      tone="info"
      appearance="flat"
      size="md"
      icon={<GraduationCap className="h-4 w-4" />}
      title={blocking
        ? tr('Teachers looking for work: create a teacher profile', 'Giáo viên tìm việc: hãy tạo hồ sơ giáo viên')
        : tr('A teacher looking for work?', 'Bạn là giáo viên đang tìm việc?')}
      className="max-w-xl"
    >
      <p>{tr('Create a free teacher profile: schools message you, and your contact stays private until you share it.', 'Tạo hồ sơ giáo viên miễn phí: trường sẽ nhắn cho bạn, và thông tin liên hệ của bạn được giữ kín cho đến khi bạn chia sẻ.')}</p>
      <Button asChild variant="cta" size="sm" className="mt-2 w-fit">
        <a href={localizedHref('/teachers/join', lang)} data-cross-link="teacher-profile">
          {tr('Create a teacher profile', 'Tạo hồ sơ giáo viên')}
        </a>
      </Button>
      {/* The two ways out: a SCHOOL that picked the wrong intent, and someone looking for other work. */}
      {blocking && <p className="mt-2 text-xs">{tr('Hiring a teacher? Choose Hiring. Not looking for teaching work? Pick another subcategory.', 'Bạn đang tuyển giáo viên? Hãy chọn Tuyển dụng. Không tìm việc dạy học? Hãy chọn danh mục con khác.')}</p>}
    </Alert>
  )
}

/** Under the category grid, before anything is picked: the same door, as one line. */
export function TeacherProfileLine() {
  const { lang, tr } = useLanguage()
  return (
    <p className="mt-3 text-sm text-body">
      {tr('A teacher looking for work?', 'Bạn là giáo viên đang tìm việc?')}{' '}
      <a href={localizedHref('/teachers/join', lang)} data-cross-link="teacher-profile" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
        {tr('Create a teacher profile', 'Tạo hồ sơ giáo viên')} <ArrowRight className="h-4 w-4 shrink-0" />
      </a>
    </p>
  )
}
