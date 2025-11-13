import type { Metadata } from 'next'
import './globals.css'
import { ReactNode } from 'react'
import { Providers } from './providers'
import { AppShell } from '@/components/app-shell'

export const metadata: Metadata = {
  title: 'Warehouse Assistant',
  description: 'ТОС + AI оптимізація складу',
}

type RootLayoutProps = {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="uk">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
