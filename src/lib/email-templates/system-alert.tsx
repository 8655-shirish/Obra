import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

import type { TemplateEntry } from './registry'

export interface SystemAlertEmailProps {
  title?: string
  severity?: string
  summary?: string
  detail?: string
  occurredAt?: string
  reference?: string
}

export function SystemAlertEmail({
  title = 'System alert',
  severity = 'warning',
  summary = 'An automated check reported an issue.',
  detail,
  occurredAt,
  reference,
}: SystemAlertEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${severity.toUpperCase()}: ${title}`}</Preview>
      <Body style={{ backgroundColor: '#f6f5fb', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        <Container style={{ margin: '0 auto', padding: '32px 24px', maxWidth: '560px' }}>
          <Text style={{ margin: 0, color: '#6d28d9', fontSize: '12px', letterSpacing: '1px' }}>
            OBRA · {severity.toUpperCase()}
          </Text>
          <Heading style={{ margin: '8px 0 16px', color: '#1f1235', fontSize: '22px' }}>
            {title}
          </Heading>
          <Section
            style={{ background: '#ffffff', borderRadius: '10px', padding: '20px', border: '1px solid #e7e2f5' }}
          >
            <Text style={{ margin: '0 0 12px', color: '#33294a', fontSize: '15px', lineHeight: '22px' }}>
              {summary}
            </Text>
            {detail ? (
              <Text
                style={{
                  margin: '0 0 12px',
                  color: '#4b4160',
                  fontSize: '13px',
                  lineHeight: '20px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {detail}
              </Text>
            ) : null}
            {occurredAt ? (
              <Text style={{ margin: 0, color: '#7a7190', fontSize: '12px' }}>Occurred at: {occurredAt}</Text>
            ) : null}
            {reference ? (
              <Text style={{ margin: '4px 0 0', color: '#7a7190', fontSize: '12px' }}>Reference: {reference}</Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SystemAlertEmail,
  displayName: 'System alert',
  subject: (data: Record<string, any>) =>
    `[${String(data?.severity ?? 'alert').toUpperCase()}] ${String(data?.title ?? 'System alert')}`,
  previewData: {
    title: 'Generation queue backlog',
    severity: 'critical',
    summary: 'The generation queue has exceeded its latency threshold.',
    detail: 'runnable_queue_age_seconds = 412 (threshold 300)',
    occurredAt: '2026-09-05T21:00:00.000Z',
    reference: 'bucket1.generation.queue_age',
  },
} satisfies TemplateEntry
