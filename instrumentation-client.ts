import posthog from 'posthog-js'

const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST

if (typeof window !== 'undefined' && token && host) {
  posthog.init(token, {
    api_host: host,
    defaults: '2026-01-30',
  })
}