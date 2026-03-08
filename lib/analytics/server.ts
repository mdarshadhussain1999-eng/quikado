import 'server-only'

import { PostHog } from 'posthog-node'
import type { AnalyticsEventName, AnalyticsProperties } from '@/lib/analytics/events'

function cleanProperties(properties?: AnalyticsProperties) {
  if (!properties) return undefined

  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined)
  )
}

export async function captureServerEvent(params: {
  distinctId: string
  event: AnalyticsEventName | string
  properties?: AnalyticsProperties
}) {
  const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST

  if (!token || !host || !params.distinctId) return

  const posthog = new PostHog(token, {
    host,
    flushAt: 1,
    flushInterval: 0,
  })

  try {
    posthog.capture({
      distinctId: params.distinctId,
      event: params.event,
      properties: cleanProperties(params.properties),
    })
  } catch (error) {
    console.error('PostHog server capture error', error)
  } finally {
    await posthog.shutdown()
  }
}