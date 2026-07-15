import { redirect } from 'next/navigation'

export default function LegacyForumRedirect() {
  redirect(process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum')
}
