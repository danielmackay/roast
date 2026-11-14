export type RoastOption = { key: string; label: string }

export type RoastQuestion = {
  id: string
  title: string
  body: string
  recommendation: string
  options: RoastOption[]
  recommendedOption?: string
}

export type RoastAnswer = {
  kind?: 'accept' | 'reject' | 'option'
  option?: string
  comment?: string
}

export type RoastRound = {
  id: string
  n: number
  source: 'tool' | 'parsed'
  createdAt: number
  questions: RoastQuestion[]
  answers: Record<string, RoastAnswer>
  status: 'open' | 'sent'
  sentAt?: number
}

export type RoastView = 'round' | 'history'

declare module 'claude-code' {
  interface PluginState {
    roast: {
      rounds: Shaped<RoastRound[]>
      cursor: number
      view: RoastView
      isActive: boolean
    }
  }
}
