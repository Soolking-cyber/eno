'use client'

// ── STEP 6 · PHOTO & PUBLISH (eno.vn, signed in — teacher onboarding redesign, 2026-10-08) ───────────────────────────
//   · An identity check the account still needs shows AT THE TOP (api/teachers/me `publishGate`) — never as a refusal
//     at the last tap.
//   · Profile photo (required) — "Use my account photo" when the account's photo is stored on eno.vn.
//   · Intro video (optional) — "Who can watch it?" appears only once there IS a video. The video's homes and moves are
//     src/lib/teachers/video.ts; the form never holds a private video's address (teacher-form.tsx owns those calls).
//   · CV (optional, private) · Phone (private; required only while "Our staff may call me" is on — owner, 2026-10-08).
//   · Job seekers only: "Email me jobs that match my profile" and "Our staff may call me" — LABELLED SWITCHES, OFF by
//     default, each its own consent (plan review C2), with ONE AI note beside them naming Anthropic (Claude) and the
//     transfer abroad. ⛔ Its meaning is AI_NOTICE_VERSION (profile.ts): the form sends it as `aiNotice` whenever an
//     opt-in is on, and the server stamps it on the opt-in — change what the note says the AI receives, who runs it or
//     where, and that version must be bumped in the same change.
//   · Edit only: "Show my profile to schools" (saves at once) and Delete.
// Publish itself — the tap that is the consent — and its notice live in the action bar (teacher-form.tsx).

import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { Alert } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Field, FieldControl, FieldDescription, FieldError } from '@/components/ui/field'
import { Fieldset } from '@/components/ui/fieldset'
import { Camera, FileText, Loader2, Lock, Play, ShieldAlert, Trash2, Video, X } from '@/components/ui/icons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Radio, RadioDot, RadioGroup } from '@/components/ui/radio-group'
import { SwitchRow } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { IDENTITY_VERIFY_PATH, identityBlockAction, identityBlockMessage } from '@/lib/identity-block-copy'
import { RADIO_CARD, type StepProps } from '@/components/teachers/steps/shared'

export type FinishMedia = {
  busy: '' | 'photo' | 'video' | 'saving'
  onPhoto: (file: File) => void
  onVideo: (file: File) => void
  /** A PRIVATE video is stored — its address never reaches the form. */
  privateVideo: boolean
  /** The public video AS SAVED: hiding THAT one cannot recall copies of its link. */
  savedPublicUrl: string | null
  ownVideoUrl: string | null
  ownVideoBusy: boolean
  videoRemoving: boolean
  confirmVideoRemove: boolean
  setConfirmVideoRemove: (v: boolean) => void
  onWatchOwnVideo: () => void
  onCloseOwnVideo: () => void
  onOwnVideoError: () => void
  onRemovePrivateVideo: () => void
  cvName: string | null
  cvFile: File | null
  onCvPick: (file: File) => void
  /** Lets go of a PICKED file that is not uploaded yet — back to the saved CV, or to none (gate review, 2026-10-08). */
  onCvDiscard: () => void
  /** Deletes the SAVED CV (edit only — its own call). */
  onCvRemove: (() => void) | null
}

export type FinishEdit = {
  live: boolean
  listingLive: boolean
  onToggleLive: (live: boolean) => void
  onDelete: () => void
}

/**
 * THE AI NOTE — ⛔ ITS MEANING IS AI_NOTICE_VERSION (src/lib/teachers/profile.ts): what it says the AI receives, who runs
 * it and where is what the opt-ins are stamped with, so changing that means bumping the version in the same change. The
 * wording is WP5's (2026-10-08), matched to what the matcher's export actually sends (scripts/teachers-match.ts — the
 * matching fields, the name taken out of the free text, never the contact ones); owner to approve before deploy (plan
 * amendment A5), with the dated /privacy paragraph that names the same recipient.
 */
export function AiNote() {
  const { tr } = useLanguage()
  return (
    <p className="text-xs text-muted-foreground" data-testid="ai-note">
      {tr('If you switch on either option above, an AI model — Anthropic\'s Claude, which processes data outside Vietnam — compares your profile with teaching jobs. It receives your headline and about text (with your name taken out), your nationality and whether you are a native speaker, the city you live in and the cities you can teach in, subjects, age groups, job types, years of experience, degree, certificate types, expected salary and start date. It never receives your name, photo, video, phone, email or CV. See our', 'Nếu bạn bật một trong hai tùy chọn trên, một mô hình AI — Claude của Anthropic, xử lý dữ liệu ngoài Việt Nam — sẽ so sánh hồ sơ của bạn với các việc làm giảng dạy. Mô hình nhận tiêu đề và phần giới thiệu của bạn (đã lược bỏ tên của bạn), quốc tịch và việc bạn có phải người bản ngữ hay không, thành phố bạn đang sống và các thành phố bạn có thể dạy, môn dạy, độ tuổi học viên, loại công việc, số năm kinh nghiệm, bằng cấp, loại chứng chỉ, mức lương mong muốn và ngày có thể bắt đầu. Mô hình không bao giờ nhận tên, ảnh, video, số điện thoại, email hay CV của bạn. Xem')}{' '}
      <Link href="/privacy" className="underline">{tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}</Link>.
    </p>
  )
}

export function FinishStep({ t, set, errors, errText, mode, signedIn, publishGate, prefillAvatar, prefillPhone, media, edit, optInsNoticeChanged }: Pick<StepProps, 't' | 'set' | 'errors' | 'errText' | 'mode'> & {
  signedIn: boolean
  publishGate: { ok: boolean; code: string | null } | null
  /** The account's photo when it is stored on eno.vn (a listing photo must be) — offered, never used unasked. */
  prefillAvatar: string | null
  /** The account's verified phone — offered, never used unasked. */
  prefillPhone: string | null
  media: FinishMedia
  edit: FinishEdit | null
  /** The stored opt-ins were given under an older AI notice, so they load OFF: say so beside the switches. */
  optInsNoticeChanged: boolean
}) {
  const { tr } = useLanguage()
  const gateLine = publishGate && !publishGate.ok ? identityBlockMessage(publishGate.code, tr) : null
  const gateAction = publishGate && !publishGate.ok ? identityBlockAction(publishGate.code) : null
  const jobSeeker = t.jobTypes.length > 0
  const hasVideo = !!t.videoUrl || media.privateVideo
  const pickerCls = cn('inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-body hover:bg-muted', !signedIn && 'pointer-events-none opacity-50')

  return (
    <div className="space-y-8">
      {gateLine && (
        <Alert tone="warning" appearance="flat" size="md" icon={<ShieldAlert className="size-4" />}>
          <span className="block">{gateLine}</span>
          {gateAction === 'verify' && (
            // A new tab: the form — its uploads included — stays open while the teacher verifies (the post wizard's rule).
            <a href={IDENTITY_VERIFY_PATH} target="_blank" rel="noopener" className="mt-1 inline-block font-semibold underline">{tr('Verify my identity', 'Xác minh danh tính')}</a>
          )}
        </Alert>
      )}

      <section className="space-y-3" {...(errors.photoUrl ? { 'data-invalid': '' } : {})}>
        <div>
          <h2 className="text-base font-semibold text-foreground">{tr('Profile photo', 'Ảnh hồ sơ')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{tr('A clear, friendly headshot.', 'Ảnh chân dung rõ mặt, thân thiện.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="relative flex size-20 items-center justify-center overflow-hidden rounded-full bg-muted">
            {t.photoUrl ? <img src={t.photoUrl} alt="" className="size-full object-cover" /> : <Camera className="size-6 text-muted-foreground" />}
          </span>
          <div className="flex flex-col items-start gap-1">
            <label className={pickerCls}>
              {media.busy === 'photo' ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              {t.photoUrl ? tr('Change photo', 'Đổi ảnh') : tr('Upload photo', 'Tải ảnh lên')}
              <input type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" className="sr-only" disabled={!signedIn} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) media.onPhoto(f) }} />
            </label>
            {prefillAvatar && t.photoUrl !== prefillAvatar && (
              <Button variant="ghost" size="sm" type="button" onClick={() => set('photoUrl', prefillAvatar)}>{tr('Use my account photo', 'Dùng ảnh tài khoản')}</Button>
            )}
          </div>
        </div>
        {errors.photoUrl && <p role="alert" className="text-sm text-destructive">{errText('photoUrl', errors.photoUrl)}</p>}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{tr('Intro video (optional)', 'Video giới thiệu (không bắt buộc)')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{tr('Up to 60 seconds: say hello and show how you teach.', 'Tối đa 60 giây: chào hỏi và cho thấy cách bạn dạy.')}</p>
        </div>
        {t.videoUrl ? (
          // Wraps on a phone: at h-40 a 16:9 player is ~284px wide, and "Remove" beside it overflowed 375px (preview check).
          <div className="flex flex-wrap items-center gap-3">
            <video src={t.videoUrl} controls className="h-40 max-w-full rounded-xl bg-black" />
            <Button variant="ghost" size="sm" type="button" onClick={() => set('videoUrl', null)}><X className="size-4" />{tr('Remove', 'Xoá')}</Button>
            {/* A new upload over a private video: say what Save will do — Remove brings the private one's card back. */}
            {media.privateVideo && <p className="w-full text-xs text-muted-foreground">{tr('Saving replaces your private intro video with this one. Schools you sent the old one to will need you to send it again.', 'Khi lưu, video này sẽ thay video giới thiệu riêng tư của bạn. Các trường đã nhận video cũ sẽ cần bạn gửi lại.')}</p>}
          </div>
        ) : media.privateVideo ? (
          // A private video: the form never holds its address — what it is, and a Remove that is its own call.
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-tint p-3">
            <Lock className="size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-sm text-body">{t.videoOnRequest
              ? tr('Your intro video is saved privately. A school sees it only when you send it in your chat.', 'Video giới thiệu của bạn được lưu riêng tư. Trường chỉ xem được khi bạn gửi trong tin nhắn.')
              : tr('Your private intro video will be shown on your profile when you save.', 'Video giới thiệu riêng tư sẽ được hiển thị trên hồ sơ khi bạn lưu.')}</p>
            {!media.ownVideoUrl && <Button variant="ghost" size="sm" type="button" onClick={media.onWatchOwnVideo} loading={media.ownVideoBusy}><Play className="size-4" />{tr('Watch', 'Xem')}</Button>}
            {media.confirmVideoRemove ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{tr('Schools you sent it to will lose access.', 'Các trường bạn đã gửi sẽ không xem được nữa.')}</span>
                <Button variant="destructive" size="sm" type="button" onClick={media.onRemovePrivateVideo} loading={media.videoRemoving}>{tr('Remove for good', 'Xoá vĩnh viễn')}</Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => media.setConfirmVideoRemove(false)}>{tr('Cancel', 'Huỷ')}</Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" type="button" onClick={() => media.setConfirmVideoRemove(true)}><X className="size-4" />{tr('Remove', 'Xoá')}</Button>
            )}
            {media.ownVideoUrl && (
              // An error (the 10-minute link expired during a long pause, or this browser cannot play the file) puts
              // Watch back, for a fresh link — never a dead player that only a reload clears (gate review).
              <video src={media.ownVideoUrl} controls playsInline preload="metadata" onError={media.onOwnVideoError} className="h-40 w-full max-w-sm rounded-xl bg-black" />
            )}
            {media.ownVideoUrl && <Button variant="ghost" size="sm" type="button" onClick={media.onCloseOwnVideo}>{tr('Close video', 'Đóng video')}</Button>}
          </div>
        ) : null}
        <label className={pickerCls}>
          {media.busy === 'video' ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
          {media.busy === 'video' ? tr('Uploading…', 'Đang tải…') : hasVideo ? tr('Replace video', 'Thay video') : tr('Upload video', 'Tải video lên')}
          {/* Cleared after each pick: choosing the same file again (a retry after a failed upload) must fire again. */}
          <input type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" disabled={!signedIn} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) media.onVideo(f) }} />
        </label>
        {/* WHO WATCHES IT — asked only once there is a video (plan, 2026-10-08), saved with the profile. Private: kept out
            of the profile and sent per school, in chat. */}
        {hasVideo && (
          <Fieldset legend={tr('Who can watch it?', 'Ai được xem video?')}>
            <RadioGroup value={t.videoOnRequest ? 'request' : 'public'} onValueChange={(v) => set('videoOnRequest', v === 'request')} className="grid gap-2 sm:grid-cols-2">
              <Radio value="public" className={RADIO_CARD}>
                <RadioDot className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{tr('Show it on my profile', 'Hiển thị trên hồ sơ')}</span>
                  <span className="block text-xs text-muted-foreground">{tr('Anyone who opens your profile can watch it.', 'Ai mở hồ sơ của bạn cũng xem được.')}</span>
                </span>
              </Radio>
              <Radio value="request" className={RADIO_CARD}>
                <RadioDot className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{tr('Keep it private — send it on request', 'Giữ riêng tư — gửi khi được đề nghị')}</span>
                  <span className="block text-xs text-muted-foreground">{tr('Schools ask in chat. You choose who gets it, and can stop sharing any time.', 'Trường đề nghị trong tin nhắn. Bạn chọn gửi cho ai và có thể ngừng chia sẻ bất cứ lúc nào.')}</span>
                </span>
              </Radio>
            </RadioGroup>
            {/* ⚠️ Hiding a video that WAS public cannot recall its link: a copy someone saved — or a cache on the way — can
                outlive the move (gate review, 2026-10-07). Said here, where the teacher chooses. */}
            {t.videoOnRequest && !!media.savedPublicUrl && t.videoUrl === media.savedPublicUrl && (
              <p className="text-xs text-warning">{tr('This video has been on your public profile, so anyone who saved its link may still be able to watch it. For a video that has never been on your profile, upload a new one.', 'Video này đã hiển thị công khai trên hồ sơ, nên ai đã lưu liên kết vẫn có thể xem được. Nếu muốn một video chưa từng hiển thị trên hồ sơ, hãy tải lên video mới.')}</p>
            )}
          </Fieldset>
        )}
        {errors.videoUrl && <p role="alert" className="text-sm text-destructive">{errText('videoUrl', errors.videoUrl)}</p>}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{tr('CV (optional)', 'CV (không bắt buộc)')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{tr('PDF, up to 10 MB. Private: a school gets it only when you tap the Share button in your chat with them.', 'PDF, tối đa 10 MB. Riêng tư: trường chỉ nhận được khi bạn bấm nút Chia sẻ trong tin nhắn với họ.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(media.cvFile || media.cvName) && <span className="inline-flex items-center gap-2 text-sm text-body"><FileText className="size-4" />{media.cvFile?.name ?? media.cvName}</span>}
          <label className={pickerCls}>
            <FileText className="size-4" />
            {media.cvFile || media.cvName ? tr('Replace CV', 'Thay CV') : tr('Choose PDF', 'Chọn tệp PDF')}
            <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={!signedIn} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) media.onCvPick(f) }} />
          </label>
          {media.onCvRemove && media.cvName && !media.cvFile && <Button variant="ghost" size="sm" type="button" onClick={media.onCvRemove}><Trash2 className="size-4" />{tr('Remove', 'Xoá')}</Button>}
          {/* ⛔ A PICK IS NOT A COMMITMENT (gate review, 2026-10-08): a picked file is uploaded only by Publish / Save
              changes, and until then it can be let go — "Replace CV" alone left no way back to no CV, or to the saved
              one, short of abandoning the form. Over a saved CV it says which one stays. */}
          {media.cvFile && (
            <Button variant="ghost" size="sm" type="button" onClick={media.onCvDiscard}>
              <X className="size-4" />{media.cvName ? tr('Keep my saved CV', 'Giữ CV đã lưu') : tr('Remove', 'Xoá')}
            </Button>
          )}
        </div>
      </section>

      <Field invalid={!!errors.phone}>
        <Label htmlFor="tf-phone">{t.staffContactOptIn ? tr('Phone number', 'Số điện thoại') : tr('Phone number (optional)', 'Số điện thoại (không bắt buộc)')}</Label>
        <FieldControl id="tf-phone" render={<Input id="tf-phone" type="tel" inputMode="tel" autoComplete="tel" value={t.phone} maxLength={20} onChange={(e) => set('phone', e.target.value)} />} />
        {prefillPhone && !t.phone && (
          <Chip size="sm" tone="neutral" className="relative tap-44 self-start" onClick={() => set('phone', prefillPhone)}>
            {tr('Use my number:', 'Dùng số của tôi:')} {prefillPhone}
          </Chip>
        )}
        <FieldDescription className="text-muted-foreground">{tr('Never shown publicly. A school gets it only when you tap the Share button in your chat — and our staff use it only if you let them call you.', 'Không bao giờ công khai. Trường chỉ nhận được khi bạn bấm nút Chia sẻ trong tin nhắn — và nhân viên của chúng tôi chỉ dùng khi bạn cho phép gọi.')}</FieldDescription>
        {errors.phone && <FieldError>{errText('phone', errors.phone)}</FieldError>}
      </Field>

      {jobSeeker && (
        <Fieldset legend={tr('Job matches (optional)', 'Gợi ý việc làm (không bắt buộc)')} className="space-y-3">
          {optInsNoticeChanged && !t.matchEmailOptIn && !t.staffContactOptIn && (
            <p role="status" className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
              {tr('The job-matching notice below has changed since you switched these on. Switch one on again to keep getting matches — saving with both off stops them.', 'Thông báo về so khớp việc làm bên dưới đã thay đổi kể từ khi bạn bật các mục này. Hãy bật lại để tiếp tục nhận gợi ý — nếu lưu khi cả hai đều tắt, gợi ý sẽ dừng.')}
            </p>
          )}
          <SwitchRow
            id="tf-match-email"
            checked={t.matchEmailOptIn}
            onChange={(v) => set('matchEmailOptIn', v)}
            label={tr('Email me jobs that match my profile', 'Gửi email cho tôi các việc làm phù hợp với hồ sơ')}
          />
          <SwitchRow
            id="tf-staff-call"
            checked={t.staffContactOptIn}
            onChange={(v) => set('staffContactOptIn', v)}
            label={tr('Our staff may call me', 'Nhân viên của chúng tôi có thể gọi cho tôi')}
            description={tr('About jobs that match your profile, and to introduce you to those schools. Needs your phone number above.', 'Về các việc làm phù hợp với hồ sơ của bạn, và để giới thiệu bạn với các trường đó. Cần số điện thoại ở trên.')}
          />
          <AiNote />
        </Fieldset>
      )}

      {mode === 'edit' && edit && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">{tr('Visibility', 'Hiển thị')}</h2>
          <SwitchRow
            checked={edit.live && edit.listingLive}
            onChange={edit.onToggleLive}
            label={tr('Show my profile to schools', 'Hiển thị hồ sơ cho các trường')}
            description={tr('Saves at once. While it is off, schools cannot find or open your profile.', 'Lưu ngay. Khi tắt, các trường không tìm thấy và không mở được hồ sơ của bạn.')}
          />
          {edit.live && !edit.listingLive && <p className="text-sm text-muted-foreground">{tr('Your profile is under review and not visible right now. Contact support if you think this is a mistake.', 'Hồ sơ của bạn đang được xem xét và tạm thời không hiển thị. Liên hệ hỗ trợ nếu bạn cho rằng có nhầm lẫn.')}</p>}
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" type="button" className="text-destructive" />}>
              <Trash2 className="size-4" />{tr('Delete my teacher profile', 'Xoá hồ sơ giáo viên')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr('Delete your teacher profile?', 'Xoá hồ sơ giáo viên?')}</AlertDialogTitle>
                <AlertDialogDescription>{tr('Your profile, intro video and CV are deleted for good.', 'Hồ sơ, video giới thiệu và CV của bạn sẽ bị xoá vĩnh viễn.')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr('Cancel', 'Huỷ')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={edit.onDelete}>{tr('Delete', 'Xoá')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      )}
    </div>
  )
}
