/**
 * THE ONE-TIME "ZALO FOR URGENT COVER" MESSAGE — the owner's approved words (2026-10-28: "yes in their chat, explain where
 * there is urgent cover it's hard to reach the needed person thats why we adapt to help teachers and schools betters";
 * the draft shown that day, approved with "go" on 2026-10-29). English only, as every jobs-desk message (compose.ts:
 * owner, 2026-10-20 "no need for vietnamese version"). Pure — src/lib/teachers/zalo-invite.ts sends it.
 * `first` = the teacher has never had a desk message: it then says once who Alex is and how to stop (compose.ts's intro,
 * word for word), so the job-messages run — which decides its own intro by "no desk message yet" — loses nothing.
 */
export const COVER_ZALO_URL = 'https://eno.vn/teachers/cover-zalo'

const FIRST_INTRO = ' Job messages are on for your eno.vn teacher profile, so we send you jobs and cover lessons that fit it. To stop them, reply STOP or switch them off at https://eno.vn/teachers/job-messages'

export function composeCoverZaloInvite(a: { firstName: string | null; first: boolean }): string {
  const name = (a.firstName || '').split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 30)
  return [
    `Hi${name ? ` ${name}` : ''}, this is Alex from eno.vn.${a.first ? FIRST_INTRO : ''}`,
    '',
    "Thanks for being open to cover lessons on eno. When a class needs urgent cover, it's often hard to reach the right teacher in time. That's why we're adapting eno to help teachers and schools work better together.",
    '',
    `You can now add your Zalo number to your cover settings. A school that needs urgent cover can then see it and contact you straight away, without waiting for a reply here. It's optional, only used for cover, and you can remove it any time: ${COVER_ZALO_URL}`,
    ...(a.first ? [] : ['', 'Reply STOP to stop these messages.']),
  ].join('\n')
}

/**
 * The bell rows — eno's fixed bilingual copy (notify.ts's idiom: stored server-side, where tr() cannot run), naming no one
 * but eno's own desk, so the bell may machine-translate them (notification-text.ts MACHINE_TRANSLATABLE). In the app only:
 * never a web push (invite.ts: the permission was given for messages, not news of a feature).
 */
export const ZALO_INVITE_TYPE = 'teacher_zalo_invite'
export const ZALO_INVITE_TITLE = 'Zalo cho dạy thay khẩn · Zalo for urgent cover'
/** The teacher got the message in the desk chat: the bell points at it. */
export const ZALO_INVITE_CHAT_BODY = 'Alex · eno.vn đã nhắn cho bạn về Zalo cho dạy thay khẩn. · Alex from eno.vn sent you a message about Zalo for urgent cover.'
/** No desk message (job messages off, or a desk message already waiting for a reply): the bell is the invite. */
export const ZALO_INVITE_BELL_BODY =
  'Mới cho giáo viên dạy thay: thêm số Zalo để trường cần dạy thay gấp có thể liên hệ bạn ngay. Không bắt buộc, chỉ dùng cho dạy thay, và bạn có thể gỡ bất cứ lúc nào. · ' +
  'New for cover teachers: add your Zalo number so a school that needs urgent cover can reach you straight away. Optional, only used for cover, and you can remove it any time.'
