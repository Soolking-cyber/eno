import { ClassroomHome } from '@/components/classroom/classroom-home'

// /classroom — one door for everyone: the landing for a guest, the teacher's class, a learner's practice. The page is a
// static shell; ClassroomHome reads /api/classroom/me on the client (the /teachers/edit pattern — no personal data in the
// HTML, so nothing personal can be cached).
export default function ClassroomPage() {
  return <ClassroomHome />
}
