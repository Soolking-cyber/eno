'use client'

import { Loader2, Trash2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ForumPost } from './forum-data'

export function DeletePostDialog({
  deleteTarget,
  deletingPost,
  setDeleteTarget,
  deletePost,
}: {
  deleteTarget: ForumPost | null
  deletingPost: boolean
  setDeleteTarget: (post: ForumPost | null) => void
  deletePost: () => Promise<void>
}) {
  const { tr } = useLanguage()
  return (
    <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deletingPost) setDeleteTarget(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"><Trash2 className="h-5 w-5" /></span>
          <DialogTitle className="text-lg font-bold">{tr('Delete this post?', 'Xóa bài viết này?')}</DialogTitle>
          <DialogDescription>{tr('This removes the discussion from the forum. This action cannot be undone.', 'Thao tác này sẽ xóa thảo luận khỏi diễn đàn và không thể hoàn tác.')}</DialogDescription>
        </DialogHeader>
        {deleteTarget && <p className="line-clamp-2 rounded-xl bg-tint px-4 py-3 text-sm font-semibold text-foreground">{deleteTarget.title}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" disabled={deletingPost} onClick={() => setDeleteTarget(null)}>{tr('Keep post', 'Giữ bài viết')}</Button>
          <Button type="button" variant="destructive" className="h-11" disabled={deletingPost} onClick={() => void deletePost()}>{deletingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{tr('Delete post', 'Xóa bài viết')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
