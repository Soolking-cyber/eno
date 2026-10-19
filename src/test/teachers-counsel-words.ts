/**
 * ⛔ THE /c/teachers WORDING THAT WAITS FOR COUNSEL (teacher visibility plan C1, decision 4; category-copy.ts TEACHERS_H1
 * has the rule). Until counsel words the school side, none of these on a page written for the people hiring:
 *   · "foreign" / "nước ngoài" — nothing in code keeps a Vietnamese teacher off the page;
 *   · the framing the counsel brief asks to avoid — supplying, providing, leasing or referring teachers ("cung cấp",
 *     "cung ứng", "cho thuê", "giới thiệu giáo viên"), brokering ("môi giới"), recruiting ("tuyển dụng"), "connecting"
 *     ("kết nối");
 *   · the teacher's own job search ("looking for work" / "đang tìm việc").
 * ONE LIST FOR EVERY SURFACE A TEST READS, so the guards cannot drift apart: the title and description
 * (category-copy.test.ts) and the rendered lede (category-lede.test.tsx). Callers NFC-normalize what they test, so a
 * decomposed "nước ngoài" cannot slip past.
 */
export const TEACHERS_COUNSEL_WORDS = /nước ngoài|foreign|cung cấp|cung ứng|cho thuê|giới thiệu giáo viên|môi giới|tuyển dụng|kết nối|looking for work|đang tìm việc/i
