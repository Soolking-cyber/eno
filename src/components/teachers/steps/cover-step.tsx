'use client'

// ── STEP 5 · COVER LESSONS (eno.vn, signed in; only when the home province holds one of the 12 cities —
// places.ts homeHasCover — teacher onboarding redesign, 2026-10-08) ───────────────────────────────────────────────
// The "Available for cover lessons" switch IS the consent, its notice beside it (cover-fields.tsx). When it is on:
// the free periods, the hourly rate, and the read-only line of where schools find the teacher for cover. A teacher who
// left the work question empty must switch it on (profile.ts `goal_required`).

import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { CoverFields, type CoverPatch } from '@/components/teachers/cover-fields'
import type { StepProps } from '@/components/teachers/steps/shared'

export function CoverStep({ t, errors, errText, onCover, onGoTo, reconsentLine, hidesProfile, zaloLink }: Pick<StepProps, 't' | 'errors' | 'errText'> & {
  onCover: (patch: CoverPatch) => void
  onGoTo: (step: 'where') => void
  /** Cover was ON under an older notice: say why the switch now shows off (teacher-form's edit load). */
  reconsentLine?: boolean
  /** An EDIT with no work wanted and cover off: saving hides the profile (plan review D6) — said before the save. */
  hidesProfile?: boolean
  /** An EDIT whose saved cover is ON: the "Zalo for urgent cover" page is one tap away (owner, 2026-10-28). */
  zaloLink?: boolean
}) {
  const { tr } = useLanguage()
  return (
    <div className="space-y-4">
      {reconsentLine && !t.coverOpen && (
        <p role="status" className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
          {tr('The cover-lessons notice has changed since you switched cover on. Switch it on again below to keep offering cover lessons — saving with it off stops them.', 'Thông báo về dạy thay đã thay đổi kể từ khi bạn bật dạy thay. Hãy bật lại bên dưới để tiếp tục nhận dạy thay — nếu lưu khi đang tắt, dạy thay sẽ dừng.')}
        </p>
      )}
      <CoverFields value={t} onChange={onCover} errors={errors} errText={errText} onChangePlaces={() => onGoTo('where')} />
      {/* Its own page and its own switch (src/lib/teachers/zalo.ts) — never saved with this form; shown once cover is SAVED
          on, because the page needs it on (a switch flipped here is not saved yet). */}
      {zaloLink && t.coverOpen && (
        <p className="text-sm">
          <Link href="/teachers/cover-zalo" className="font-semibold text-accent-foreground hover:underline">
            {tr('Zalo for urgent cover: let schools reach you straight away', 'Zalo cho dạy thay khẩn: cho phép các trường liên hệ ngay với bạn')}
          </Link>
        </p>
      )}
      {hidesProfile && (
        <p role="status" className="text-sm text-muted-foreground">
          {/* Never "any time": showing it again needs a goal first (setTeacherStatus refuses one with none — gate review, 2026-10-09). */}
          {tr('With cover lessons off and no work chosen in step 1, saving hides your profile — schools would have nothing to find you for. To show it again later, pick the work you want or switch cover lessons on first.', 'Khi tắt dạy thay và không chọn công việc ở bước 1, việc lưu sẽ ẩn hồ sơ — các trường không có gì để tìm bạn. Để hiển thị lại sau này, trước hết hãy chọn công việc bạn muốn hoặc bật dạy thay.')}
        </p>
      )}
    </div>
  )
}
