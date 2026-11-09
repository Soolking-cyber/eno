import { ClassroomHome } from '@/components/classroom/classroom-home'

// /classroom/avatar — the one-avatar wizard's old address (before 2026-11-09, several tutors). Emails already sent ("your 3D
// avatar is ready") and bookmarks still open it, so it shows the class page — its tutors and "New tutor" — rather than a 404.
// ⛔ Not a redirect: every file under the classroom route stays thin and static (layout.test.tsx).
export default function ClassroomAvatarPage() {
  return <ClassroomHome />
}
