'use client'

import { useEffect, useState } from 'react'
import { Bold, FileText, ImagePlus, Italic, List, Loader2, MessageSquareText, ShieldCheck, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { IconButton } from '@/components/ui/icon-button'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { FORUM_COMMUNITIES, type ForumPost } from './forum-data'

export type NewForumPost = Pick<ForumPost, 'community' | 'title' | 'body' | 'kind'> & {
  media?: Array<{ storagePath: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; altText: string | null }>
}

function characterCount(current: number, maximum: number): string {
  return `${current}/${maximum}`
}

function ImagePreview({ file }: { file: File }) {
  const [url] = useState(() => URL.createObjectURL(file))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img src={url} alt="" className="h-20 w-full rounded-lg object-cover" />
}

export function CreatePostDialog({
  open,
  defaultCommunity,
  onOpenChange,
  onPublish,
}: {
  open: boolean
  defaultCommunity?: string
  onOpenChange: (open: boolean) => void
  onPublish: (post: NewForumPost) => void | Promise<void>
}) {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const [community, setCommunity] = useState(defaultCommunity || 'vietnam-101')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [images, setImages] = useState<File[]>([])
  const selectedCommunity = FORUM_COMMUNITIES.find((item) => item.slug === community)

  useEffect(() => {
    if (open) setCommunity(defaultCommunity || 'vietnam-101')
  }, [open, defaultCommunity])

  const titleError = submitted && title.trim().length < 8
    ? tr('Use at least 8 characters so people understand the topic.', 'Hãy dùng ít nhất 8 ký tự để mọi người hiểu chủ đề.')
    : ''
  const bodyError = submitted && body.trim().length < 20
    ? tr('Add a little context — at least 20 characters.', 'Hãy thêm một chút bối cảnh — ít nhất 20 ký tự.')
    : ''

  const reset = () => {
    setTitle('')
    setBody('')
    setSubmitted(false)
    setImages([])
  }

  const close = () => {
    reset()
    onOpenChange(false)
  }

  const formatSelection = (before: string, after = before) => {
    const editor = document.getElementById('forum-post-body') as HTMLTextAreaElement | null
    if (!editor) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = body.slice(start, end)
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`
    setBody(next)
    requestAnimationFrame(() => {
      editor.focus()
      editor.setSelectionRange(start + before.length, end + before.length)
    })
  }

  const addImages = (files: FileList | null) => {
    if (!files) return
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
    const next = Array.from(files).filter((file) => allowed.has(file.type) && file.size <= 10 * 1024 * 1024)
    setImages((current) => [...current, ...next].slice(0, 8))
  }

  const uploadImages = async () => {
    if (images.length === 0) return []
    if (!user) throw new Error('auth_required')
    const supabase = createSupabaseBrowser()
    const jobs = images.map((file, index) => {
      const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || file.type.split('/')[1] || 'jpg'
      return { file, path: `${user.id}/${crypto.randomUUID()}/${index}.${extension}` }
    })
    const uploaded: string[] = []
    const queue = [...jobs]
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const { error } = await supabase.storage.from('forum-media').upload(job.path, job.file, { contentType: job.file.type, upsert: false })
        if (error) throw error
        uploaded.push(job.path)
      }
    }
    const results = await Promise.allSettled(Array.from({ length: Math.min(3, jobs.length) }, worker))
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) {
      if (uploaded.length) await supabase.storage.from('forum-media').remove(uploaded).catch(() => {})
      throw failed.reason
    }
    return jobs.map(({ path }, index) => ({
      storagePath: path,
      mimeType: images[index].type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
      altText: images[index].name || null,
    }))
  }

  const publish = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (title.trim().length < 8 || body.trim().length < 20) return
    setPublishing(true)
    let uploadedPaths: string[] = []
    try {
      const media = await uploadImages()
      uploadedPaths = media.map((item) => item.storagePath)
      await onPublish({ community, title: title.trim(), body: body.trim(), kind: 'discussion', media })
      reset()
      onOpenChange(false)
    } catch {
      // Parent surfaces the API-specific error and keeps the draft intact.
      if (uploadedPaths.length) await createSupabaseBrowser().storage.from('forum-media').remove(uploadedPaths).catch(() => {})
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card p-0 sm:max-w-2xl">
        <form onSubmit={publish}>
          <DialogHeader className="border-b border-border px-5 py-5 pr-14 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <MessageSquareText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold text-foreground">
                  {tr('Start a conversation', 'Bắt đầu cuộc trò chuyện')}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {tr('Ask clearly, share context, and help the right people find you.', 'Hỏi rõ ràng, chia sẻ bối cảnh để đúng người có thể giúp bạn.')}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 px-5 py-5 sm:px-6">
            <div className="space-y-1.5">
              <p id="forum-community-label" className="text-sm font-medium text-foreground">
                {tr('Community', 'Cộng đồng')}
              </p>
              <Select value={community} onValueChange={(value) => { if (typeof value === 'string') setCommunity(value) }}>
                <SelectTrigger aria-labelledby="forum-community-label" className="h-11 w-full cursor-pointer rounded-xl border-line-strong bg-background px-3">
                  <SelectValue>{selectedCommunity ? tr(selectedCommunity.name, selectedCommunity.nameVi) : ''}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" className="min-w-[min(22rem,calc(100vw-2rem))]">
                  {FORUM_COMMUNITIES.map((item) => (
                    <SelectItem key={item.slug} value={item.slug}>
                      {tr(item.name, item.nameVi)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Field invalid={Boolean(titleError)}>
              <FieldLabel>{tr('Title', 'Tiêu đề')}</FieldLabel>
              <FieldControl
                id="forum-post-title"
                render={
                  <Input
                    id="forum-post-title"
                    variant="outline"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={140}
                    placeholder={tr('What do you want the community to help with?', 'Bạn muốn cộng đồng giúp điều gì?')}
                  />
                }
              />
              <div className="flex items-start justify-between gap-3">
                <FieldDescription>{tr('Specific titles get better answers.', 'Tiêu đề cụ thể sẽ nhận được câu trả lời tốt hơn.')}</FieldDescription>
                <span className="shrink-0 text-xs tabular-nums text-ink-4">{characterCount(title.length, 140)}</span>
              </div>
              {titleError && <FieldError>{titleError}</FieldError>}
            </Field>

            <Field invalid={Boolean(bodyError)}>
              <FieldLabel>{tr('Details', 'Chi tiết')}</FieldLabel>
              <div className="flex items-center gap-1 rounded-t-xl border border-b-0 border-line-strong bg-tint px-2 py-1.5">
                <IconButton type="button" size="sm" className="text-body hover:bg-card" aria-label={tr('Bold', 'In đậm')} onClick={() => formatSelection('**')}><Bold className="h-4 w-4" /></IconButton>
                <IconButton type="button" size="sm" className="text-body hover:bg-card" aria-label={tr('Italic', 'In nghiêng')} onClick={() => formatSelection('_')}><Italic className="h-4 w-4" /></IconButton>
                <IconButton type="button" size="sm" className="text-body hover:bg-card" aria-label={tr('Bulleted list', 'Danh sách dấu đầu dòng')} onClick={() => formatSelection('\n- ', '')}><List className="h-4 w-4" /></IconButton>
                <IconButton type="button" size="sm" className="text-body hover:bg-card" aria-label={tr('Add images', 'Thêm hình ảnh')} onClick={() => document.getElementById('forum-post-images')?.click()}><ImagePlus className="h-4 w-4" /></IconButton>
                <input id="forum-post-images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only" onChange={(event) => { addImages(event.target.files); event.target.value = '' }} />
                <span className="ml-auto text-2xs text-ink-4">{tr('Simple formatting', 'Định dạng cơ bản')}</span>
              </div>
              <FieldControl
                id="forum-post-body"
                render={
                  <Textarea
                    id="forum-post-body"
                    variant="outline"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={7}
                    maxLength={3000}
                    placeholder={tr('Share what happened, what you already tried, and where in Vietnam this applies.', 'Chia sẻ điều đã xảy ra, những gì bạn đã thử và khu vực áp dụng tại Việt Nam.')}
                    className="rounded-t-none"
                  />
                }
              />
              <div className="flex items-start justify-between gap-3">
                <FieldDescription>{tr('No phone numbers or sensitive document details.', 'Không đăng số điện thoại hoặc thông tin giấy tờ nhạy cảm.')}</FieldDescription>
                <span className="shrink-0 text-xs tabular-nums text-ink-4">{characterCount(body.length, 3000)}</span>
              </div>
              {bodyError && <FieldError>{bodyError}</FieldError>}
            </Field>

            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {images.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}-${index}`} className="relative overflow-hidden rounded-xl bg-tint p-2">
                    <ImagePreview file={file} />
                    <IconButton type="button" size="sm" className="absolute right-1 top-1 bg-card text-body shadow-sm" aria-label={tr('Remove image', 'Xóa hình ảnh')} onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                      <X className="h-3.5 w-3.5" />
                    </IconButton>
                    <p className="mt-1 truncate text-2xs text-body">{file.name}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 rounded-xl bg-accent p-3 text-accent-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs leading-relaxed">
                {tr('Your post is saved to the same secure account and moderation system as eno.vn.', 'Bài viết được lưu vào cùng tài khoản và hệ thống kiểm duyệt an toàn như eno.vn.')}
              </p>
            </div>
          </div>

          <DialogFooter className="border-t border-border bg-tint/60 px-5 py-4 sm:px-6">
            <Button type="button" variant="bare" onClick={close}>
              {tr('Cancel', 'Hủy')}
            </Button>
            <Button type="submit" variant="cta" disabled={publishing}>
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {publishing ? tr('Publishing…', 'Đang đăng…') : tr('Publish post', 'Đăng bài')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
