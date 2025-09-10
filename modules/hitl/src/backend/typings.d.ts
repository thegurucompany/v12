export type HitlSessionOverview = {
  lastMessage: Message
  user: User
} & HitlSession

export interface HitlSession {
  id: string
  botId: string
  channel: string
  userId: string
  threadId?: string
  lastEventOn: Date
  lastHeardOn: Date
  isPaused: boolean
  pausedBy: string
  sentiment?: 'positivo' | 'negativo' | 'neutro'
  tags?: string[]
  issueResolved?: boolean
  userType?: string
}

export interface User {
  id: string
  fullName: string
  avatarUrl: string
  attributes: object
}

export interface Message {
  id: number
  type: string
  text: string
  /** The complete payload  */
  raw_message: any
  direction: 'out' | 'in'
  source: 'bot' | 'user' | 'agent'
  ts: Date
  readonly session_id?: string
}

export interface UserIdentification {
  id: number
  number: string
  user_type: string
  created_at: Date
  updated_at: Date
}

// Hitl sessions can either be identified by sessionId, or a combination of botId, channel and target
export interface SessionIdentity {
  botId?: string
  channel?: string
  threadId?: string
  userId?: string
  sessionId?: string
}
