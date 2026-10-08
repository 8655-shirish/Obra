import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
  token?: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
  token,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {token
        ? `Your ${siteName} verification code: ${token}`
        : `Your login link for ${siteName}`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>OBRA</Text>
        {token ? (
          <>
            <Heading style={h1}>Your {siteName} verification code</Heading>
            <Text style={text}>Enter this code in {siteName}:</Text>
            <Section style={codeBox}>
              <Text style={codeText}>{token}</Text>
            </Section>
            <Text style={footer}>
              This code expires shortly. If you didn&apos;t request it, you can
              safely ignore this email.
            </Text>
          </>
        ) : (
          <>
            <Heading style={h1}>Your login link</Heading>
            <Text style={text}>
              Click the button below to log in to {siteName}. This link will
              expire shortly.
            </Text>
            <Button style={button} href={confirmationUrl}>
              Log In
            </Button>
            <Text style={footer}>
              If you didn&apos;t request this link, you can safely ignore this
              email.
            </Text>
          </>
        )}
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const brand = {
  margin: '0 0 16px',
  color: '#6d28d9',
  fontSize: '12px',
  fontWeight: 'bold' as const,
  letterSpacing: '1px',
}
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#1f1235',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const codeBox = {
  backgroundColor: '#f6f5fb',
  border: '1px solid #e7e2f5',
  borderRadius: '10px',
  padding: '16px 20px',
  margin: '0 0 20px',
  textAlign: 'center' as const,
}
const codeText = {
  margin: 0,
  fontSize: '24px',
  fontWeight: 'bold' as const,
  letterSpacing: '4px',
  color: '#1f1235',
}
const button = {
  backgroundColor: '#6d28d9',
  color: '#ffffff',
  fontSize: '14px',
  border: '1px solid #6d28d9',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
