import Bluebird from 'bluebird'
import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import { Config } from '../config'
import { MODULE_NAME } from '../constants'
import { ExitTypes, IHandoff, ISocketMessage } from '../types'
import { StateType } from '.'
import Repository from './repository'
import WebHookService from './webhook'

export const toEventDestination = (
  botId: string,
  handoff: Pick<IHandoff, 'userId' | 'userThreadId' | 'userChannel'>
): sdk.IO.EventDestination => {
  return { botId, target: handoff.userId, threadId: handoff.userThreadId, channel: handoff.userChannel }
}

interface Realtime {
  sendPayload: (botId: string, message: ISocketMessage) => void
}

class Service {
  webhook: WebHookService
  constructor(
    private bp: typeof sdk,
    private state: StateType,
    private repository: Repository,
    private realtime: Realtime
  ) {
    this.webhook = new WebHookService(bp)
  }

  async createHandoff(
    botId: string,
    dest: Pick<IHandoff, 'userId' | 'userThreadId' | 'userChannel' | 'status'>,
    timeoutDelay: number
  ) {
    const config: Config = await this.bp.config.getModuleConfigForBot(MODULE_NAME, botId)
    const eventDestination = toEventDestination(botId, dest)
    const attributes = await this.bp.users.getAttributes(dest.userChannel, dest.userId)
    const language = attributes.language

    const handoff = await this.repository.createHandoff(botId, dest).then(handoff => {
      this.state.cacheHandoff(botId, handoff.userThreadId, handoff)
      return handoff
    })

    if (config.transferMessage) {
      await this.sendMessageToUser(config.transferMessage, eventDestination, language)
    }

    this.sendPayload(botId, { resource: 'handoff', type: 'create', id: handoff.id, payload: handoff })

    // Auto-assign to available agent if enabled
    if (config.autoAssignConversations && handoff.status === 'pending') {
      this.bp.logger.forBot(botId).info(`Auto-assignment enabled, attempting to assign handoff ${handoff.id}`)
      setTimeout(async () => {
        try {
          await this.autoAssignHandoff(botId, handoff)
        } catch (error) {
          this.bp.logger.forBot(botId).error('Error in auto-assignment:', error.message)
        }
      }, 1000) // Small delay to ensure handoff is fully created
    }

    if (timeoutDelay !== undefined && timeoutDelay > 0) {
      setTimeout(async () => {
        const userHandoff = await this.repository.getHandoff(handoff.id)

        if (userHandoff.status === 'pending') {
          await this.updateHandoff(userHandoff.id, botId, { status: 'expired' })
          await this.transferToBot(eventDestination, 'timedOutWaitingAgent')
        }
      }, timeoutDelay * 1000)
    }

    return handoff
  }

  /**
   * Auto-assign a handoff to an available agent using equitable distribution.
   * The system now assigns conversations to the agent with the least number
   * of currently assigned (active) conversations to ensure fair workload distribution.
   */
  async autoAssignHandoff(botId: string, handoff: IHandoff) {
    try {
      // Check if handoff is still pending
      const currentHandoff = await this.repository.getHandoff(handoff.id)
      if (currentHandoff.status !== 'pending') {
        this.bp.logger.forBot(botId).info(`Handoff ${handoff.id} is no longer pending, skipping auto-assignment`)
        return
      }

      // Find available agent
      const availableAgent = await this.repository.getAvailableAgent(botId)
      if (!availableAgent) {
        this.bp.logger.forBot(botId).info(`No available agents found for auto-assignment of handoff ${handoff.id}`)
        return
      }

      this.bp.logger.forBot(botId).info(`Auto-assigning handoff ${handoff.id} to agent ${availableAgent.agentId}`)

      // Create agent conversation
      const userId = await this.repository.mapVisitor(botId, availableAgent.agentId)
      const conversation = await this.bp.messaging.forBot(botId).createConversation(userId)

      const agentThreadId = conversation.id
      const payload: Pick<IHandoff, 'agentId' | 'agentThreadId' | 'assignedAt' | 'status'> = {
        agentId: availableAgent.agentId,
        agentThreadId,
        assignedAt: new Date(),
        status: 'assigned'
      }

      // Update handoff
      const updatedHandoff = await this.repository.updateHandoff(botId, handoff.id, payload)
      this.state.cacheHandoff(botId, agentThreadId, updatedHandoff)

      // Send assignment message to user
      const config: Config = await this.bp.config.getModuleConfigForBot(MODULE_NAME, botId)
      if (config.assignMessage) {
        const attributes = await this.bp.users.getAttributes(handoff.userChannel, handoff.userId)
        const language = attributes.language
        const eventDestination = toEventDestination(botId, handoff)

        await this.sendMessageToUser(config.assignMessage, eventDestination, language, {
          agentName: availableAgent.attributes?.firstname || availableAgent.agentId
        })
      }

      // Copy recent conversation history to agent thread
      await this.copyConversationHistory(botId, handoff, agentThreadId, userId)

      // Update realtime
      this.updateRealtimeHandoff(botId, updatedHandoff)

      this.bp.logger
        .forBot(botId)
        .info(`Successfully auto-assigned handoff ${handoff.id} to agent ${availableAgent.agentId}`)
    } catch (error) {
      this.bp.logger.forBot(botId).error(`Failed to auto-assign handoff ${handoff.id}:`, error.message)
    }
  }

  /**
   * Copy conversation history to agent thread
   */
  async copyConversationHistory(botId: string, handoff: IHandoff, agentThreadId: string, agentUserId: string) {
    try {
      const recentUserConversationEvents = await this.bp.events.findEvents(
        { botId, threadId: handoff.userThreadId },
        { count: 32, sortOrder: [{ column: 'createdOn', desc: true }] }
      )

      const messageEvents = recentUserConversationEvents.filter(e => {
        const p = e.event?.payload
        return p && (p.text || p.image || p.file || p.type === 'text' || p.type === 'image' || p.type === 'file')
      })

      const orderedEvents = messageEvents
        .sort((a, b) => new Date(a.event.createdOn).getTime() - new Date(b.event.createdOn).getTime())
        .slice(-20)

      this.bp.logger
        .forBot(botId)
        .info(`[hitlnext] Auto-assignment: Copiando ${orderedEvents.length} mensajes al thread del agente`)

      await Promise.mapSeries(orderedEvents, async event => {
        try {
          await this.bp.messaging
            .forBot(botId)
            .createMessage(
              agentThreadId,
              event.direction === 'incoming' ? undefined : event.target,
              event.event.payload
            )
        } catch (err) {
          this.bp.logger.warn(`[hitlnext] No se pudo copiar el mensaje ${event.id} al thread del agente:`, err.message)
        }
        await Bluebird.delay(5)
      })
    } catch (error) {
      this.bp.logger.forBot(botId).error('Error copying conversation history during auto-assignment:', error.message)
    }
  }

  async resolveHandoff(handoff: IHandoff, botId: string, payload) {
    const config: Config = await this.bp.config.getModuleConfigForBot(MODULE_NAME, botId)
    const eventDestination = toEventDestination(botId, handoff)
    const updated = await this.updateHandoff(handoff.id, botId, payload)

    // Enviar mensaje de resolución al usuario antes de transferir de vuelta al bot
    if (config.resolveMessage) {
      const attributes = await this.bp.users.getAttributes(handoff.userChannel, handoff.userId)
      const language = attributes.language
      await this.sendMessageToUser(config.resolveMessage, eventDestination, language)
    }

    // Limpiar toda la caché cuando se resuelve el handoff
    await this.clearUserCache(botId, handoff)

    await this.transferToBot(eventDestination, 'handoffResolved')

    return updated
  }

  async updateHandoff(id: string, botId: string, payload: any) {
    const updated = await this.repository.updateHandoff(botId, id, payload)

    if (updated.status !== 'pending') {
      this.state.expireHandoff(botId, updated.userThreadId)
    } else {
      this.state.cacheHandoff(botId, updated.userThreadId, updated)
    }

    this.updateRealtimeHandoff(botId, updated)

    return updated
  }

  async sendMessageToUser(
    text: { [lang: string]: string },
    eventDestination: sdk.IO.EventDestination,
    language: string,
    args?: any
  ) {
    const event = { state: { user: { language } } }
    const message = await this.bp.cms.renderElement(
      '@builtin_text',
      { type: 'text', text, event, ...args },
      eventDestination
    )
    this.bp.events.replyToEvent(eventDestination, message)
  }

  updateRealtimeHandoff(botId: string, handoff: Partial<IHandoff>) {
    return this.sendPayload(botId, { resource: 'handoff', type: 'update', id: handoff.id, payload: handoff })
  }

  async transferToBot(event: sdk.IO.EventDestination, exitType: ExitTypes, agentName?: string) {
    const stateUpdate = this.bp.IO.Event({
      ..._.pick(event, ['botId', 'channel', 'target', 'threadId']),
      direction: 'incoming',
      payload: { exitType, agentName },
      preview: 'none',
      type: 'hitlnext'
    })

    await this.bp.events.sendEvent(stateUpdate)
  }

  sendPayload(botId: string, data: { resource: string; type: string; id: string; payload: any }) {
    this.realtime.sendPayload(botId, data)
    void this.webhook.send({ botId, ...data })
  }

  async clearUserCache(botId: string, handoff: IHandoff) {
    const eventDestination = toEventDestination(botId, handoff)

    try {
      // Crear sessionId usando la información del handoff
      const sessionId = this.bp.dialog.createId({
        botId,
        target: handoff.userId,
        threadId: handoff.userThreadId,
        channel: handoff.userChannel
      })

      // Eliminar sesión completa del motor de diálogo
      await this.bp.dialog.deleteSession(sessionId, botId)

      // Limpiar atributos del usuario (mantener solo información básica)
      await this.bp.users.updateAttributes(handoff.userChannel, handoff.userId, {})

      // Limpiar también la caché específica del handoff
      this.state.expireHandoff(botId, handoff.userThreadId)
      if (handoff.agentThreadId) {
        this.state.expireHandoff(botId, handoff.agentThreadId)
      }

      this.bp.logger.forBot(botId).info(`Cache cleared for user ${handoff.userId} after handoff resolution`, {
        handoffId: handoff.id,
        userId: handoff.userId,
        channel: handoff.userChannel,
        threadId: handoff.userThreadId,
        agentThreadId: handoff.agentThreadId
      })
    } catch (error) {
      this.bp.logger.forBot(botId).error('Error clearing user cache after handoff resolution', {
        error: error.message,
        handoffId: handoff.id,
        userId: handoff.userId
      })
    }
  }
}

export default Service
