const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn').replace(/\/$/, '')

/**
 * The eno account dashboard has one owner and one URL. Forum surfaces link to it
 * directly; they never mount a second dashboard rail or bounce through a local
 * redirect route first.
 */
export const ENO_DASHBOARD_URL = `${MARKETPLACE_URL}/dashboard`
