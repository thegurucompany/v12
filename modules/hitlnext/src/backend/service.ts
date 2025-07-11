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
