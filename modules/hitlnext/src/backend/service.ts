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
          this.bp.logger.forBot(botId).info(`Handoff ${handoff.id} timed out waiting for agent, returning to bot`)

          // Send timeout message to user first
          const attributes = await this.bp.users.getAttributes(userHandoff.userChannel, userHandoff.userId)
          const language = attributes.language

          await this.sendMessageToUser(
            {
              en:
                "No agents were available to help you at this time, so I'll continue our conversation 💻\n\nHow can I help you?",
              es:
                'No había agentes disponibles para ayudarte en este momento, así que continuaré nuestra conversación 💻\n\n¿Cómo puedo ayudarte?'
            },
            eventDestination,
            language
          )

          // Close handoff completely instead of just marking as expired
          await this.closeHandoffAndReturnToBot(botId, userHandoff, 'timedOutWaitingAgent')
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

  /**
   * Reassign all conversations from an agent back to pending state
   * The auto-assignment algorithm will then handle reassignment
   */
  async reassignAllAgentConversations(botId: string, agentId: string): Promise<{ reassigned: number; errors: number }> {
    let reassigned = 0
    let errors = 0

    try {
      // Get module configuration
      const config: Config = await this.bp.config.getModuleConfigForBot(MODULE_NAME, botId)

      // Get all conversations assigned to this agent
      const handoffs = await this.repository.getHandoffsForAgent(botId, agentId)

      this.bp.logger.forBot(botId).info(`Found ${handoffs.length} conversations assigned to agent ${agentId}`)

      // Get agent info for messaging
      const agentInfo = await this.repository.getAgent(agentId)
      const agentName = agentInfo?.attributes?.firstname || agentInfo?.attributes?.email || 'un agente'

      // Unassign each conversation and attempt reassignment
      for (const handoff of handoffs) {
        try {
          this.bp.logger
            .forBot(botId)
            .info(`Processing handoff ${handoff.id}, originally assigned to agent ${handoff.agentId}`)

          // Send initial reassignment message to user only if enabled
          if (config.transferMessageEnabled) {
            const eventDestination = toEventDestination(botId, handoff)
            const attributes = await this.bp.users.getAttributes(handoff.userChannel, handoff.userId)
            const language = attributes.language

            // Use custom message if configured, otherwise use default
            const reassignMessage = config.reassignMessage || {
              en:
                'Agent {{agentName}} has reassigned your conversation. We are looking for another available agent, please wait a moment.',
              es:
                'El agente {{agentName}} ha reasignado su conversación. Estamos buscando otro agente disponible, por favor espere un momento.'
            }

            await this.sendMessageToUser(reassignMessage, eventDestination, language, {
              agentName
            })
          }

          // Unassign the conversation (set back to pending)
          const updatedHandoff = await this.repository.unassignHandoff(botId, handoff.id)

          // Only clear the agent thread cache, keep the user thread cache for middleware to work
          if (handoff.agentThreadId) {
            this.state.expireHandoff(botId, handoff.agentThreadId)
          }
          // Re-cache with updated handoff data (now pending) so middleware can still find it
          this.state.cacheHandoff(botId, handoff.userThreadId, updatedHandoff)

          this.bp.logger
            .forBot(botId)
            .info(`Kept cache for userThreadId: ${handoff.userThreadId} during reassignment of handoff ${handoff.id}`)

          // Update realtime
          this.updateRealtimeHandoff(botId, updatedHandoff)

          // Attempt to reassign to another agent (pass the original agentId to exclude them)
          await this.attemptReassignment(botId, updatedHandoff, agentName, agentId)

          reassigned++

          this.bp.logger
            .forBot(botId)
            .info(`Successfully processed reassignment for handoff ${handoff.id} from agent ${agentId}`)
        } catch (error) {
          errors++
          this.bp.logger.forBot(botId).error(`Failed to reassign handoff ${handoff.id}:`, error.message)
        }
      }
    } catch (error) {
      this.bp.logger.forBot(botId).error(`Error during bulk reassignment for agent ${agentId}:`, error.message)
      throw error
    }

    return { reassigned, errors }
  }

  /**
   * Attempt to reassign a handoff to another available agent
   * This is a specific function for manual reassignments, separate from auto-assignment
   */
  private async attemptReassignment(
    botId: string,
    handoff: IHandoff,
    originalAgentName: string,
    excludeAgentId?: string
  ) {
    try {
      // Small delay to ensure the handoff is fully unassigned and to make the process feel more natural
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Find an available agent (excluding the original one if possible)
      const availableAgent = await this.repository.getAvailableAgentForReassignment(botId, excludeAgentId)
      const eventDestination = toEventDestination(botId, handoff)
      const attributes = await this.bp.users.getAttributes(handoff.userChannel, handoff.userId)
      const language = attributes.language

      if (availableAgent) {
        this.bp.logger
          .forBot(botId)
          .info(`Reassigning handoff ${handoff.id} to agent ${availableAgent.agentId} (excluded: ${excludeAgentId})`)

        // Create new agent conversation
        const userId = await this.repository.mapVisitor(botId, availableAgent.agentId)
        const conversation = await this.bp.messaging.forBot(botId).createConversation(userId)

        const agentThreadId = conversation.id
        const payload: Pick<IHandoff, 'agentId' | 'agentThreadId' | 'assignedAt' | 'status'> = {
          agentId: availableAgent.agentId,
          agentThreadId,
          assignedAt: new Date(),
          status: 'assigned'
        }

        // Update handoff with new assignment
        const updatedHandoff = await this.repository.updateHandoff(botId, handoff.id, payload)

        this.bp.logger.forBot(botId).info(`Updated handoff ${handoff.id} in database`, {
          status: updatedHandoff.status,
          agentId: updatedHandoff.agentId,
          agentThreadId: updatedHandoff.agentThreadId,
          userThreadId: updatedHandoff.userThreadId
        })

        // CRITICAL: Cache the handoff for both threads
        // The middleware looks up handoffs by userThreadId, so we need to cache it there
        this.state.cacheHandoff(botId, updatedHandoff.userThreadId, updatedHandoff)
        // Also cache by agentThreadId for agent-to-user communication
        this.state.cacheHandoff(botId, agentThreadId, updatedHandoff)

        this.bp.logger
          .forBot(botId)
          .info(
            `Cached handoff ${handoff.id} for userThreadId: ${updatedHandoff.userThreadId} and agentThreadId: ${agentThreadId}`
          )

        // Wait a bit to ensure cache propagation
        await new Promise(resolve => setTimeout(resolve, 500))

        // Force reload from database to ensure consistency
        const reloadedHandoff = await this.repository.getHandoff(handoff.id)
        if (reloadedHandoff) {
          // Re-cache with the fresh data from database
          this.state.cacheHandoff(botId, reloadedHandoff.userThreadId, reloadedHandoff)
          this.state.cacheHandoff(botId, reloadedHandoff.agentThreadId, reloadedHandoff)
          this.bp.logger.forBot(botId).info(`Re-cached handoff ${handoff.id} with fresh data from database`, {
            status: reloadedHandoff.status,
            agentId: reloadedHandoff.agentId,
            userThreadId: reloadedHandoff.userThreadId,
            agentThreadId: reloadedHandoff.agentThreadId
          })
        }

        // Copy conversation history to new agent thread
        await this.copyConversationHistory(botId, handoff, agentThreadId, userId)

        // Send success message to user only if enabled
        const config: Config = await this.bp.config.getModuleConfigForBot(MODULE_NAME, botId)
        if (config.transferMessageEnabled) {
          const newAgentName =
            availableAgent.attributes?.firstname || availableAgent.attributes?.email || 'nuevo agente'

          // Use custom message if configured, otherwise use default
          const reassignSuccessMessage = config.reassignSuccessMessage || {
            en: 'Your conversation has been reassigned to agent {{agentName}}.',
            es: 'Su conversación ha sido reasignada al agente {{agentName}}.'
          }

          await this.sendMessageToUser(reassignSuccessMessage, eventDestination, language, {
            agentName: newAgentName
          })
        }

        // Update realtime
        this.updateRealtimeHandoff(botId, updatedHandoff)

        this.bp.logger
          .forBot(botId)
          .info(`Successfully reassigned handoff ${handoff.id} to agent ${availableAgent.agentId}`)
      } else {
        // No agents available, close handoff and return to bot
        this.bp.logger
          .forBot(botId)
          .info(`No agents available for reassignment of handoff ${handoff.id}, closing handoff and returning to bot`)

        // Send no agents available message
        await this.sendMessageToUser(
          {
            en:
              "There are no agents available at the moment 📴 so MIA will take over the conversation with you 💻\n\nShe'll do her best to assist you and provide a quick solution 🤖✨",
            es:
              'No hay agentes conectados por ahora 📴 así que MIA retomará la conversación contigo 💻\n\nHará lo posible por ayudarte y darte una solución rápida 🤖✨'
          },
          eventDestination,
          language
        )

        // Close handoff and return to bot
        await this.closeHandoffAndReturnToBot(botId, handoff, 'reassignmentNoAgents', originalAgentName)
      }
    } catch (error) {
      this.bp.logger.forBot(botId).error(`Failed to reassign handoff ${handoff.id}:`, error.message)

      // If reassignment fails, try to transfer back to bot as fallback
      try {
        const config: Config = await this.bp.config.getModuleConfigForBot(MODULE_NAME, botId)

        // Only send error message if transfer messages are enabled
        if (config.transferMessageEnabled) {
          const eventDestination = toEventDestination(botId, handoff)
          const attributes = await this.bp.users.getAttributes(handoff.userChannel, handoff.userId)
          const language = attributes.language

          // Use custom message if configured, otherwise use default
          const reassignErrorMessage = config.reassignErrorMessage || {
            en: 'Sorry, there was an error reassigning your conversation. Your conversation has been returned to me.',
            es: 'Lo siento, hubo un error al reasignar su conversación. Su conversación me ha sido devuelta.'
          }

          await this.sendMessageToUser(reassignErrorMessage, eventDestination, language)
        }

        // Close handoff and return to bot due to error
        await this.closeHandoffAndReturnToBot(botId, handoff, 'reassignmentError', originalAgentName)
      } catch (fallbackError) {
        this.bp.logger.forBot(botId).error('Failed to transfer to bot as fallback:', fallbackError.message)
      }
    }
  }

  async resolveHandoff(handoff: IHandoff, botId: string, payload) {
    const config: Config = await this.bp.config.getModuleConfigForBot(MODULE_NAME, botId)
    const eventDestination = toEventDestination(botId, handoff)
    const updated = await this.updateHandoff(handoff.id, botId, payload)

    // Enviar mensaje de resolución al usuario antes de transferir de vuelta al bot
    // Este mensaje siempre se muestra para que el usuario sepa que está de vuelta con el bot
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
    const isReassignmentTransfer = exitType === 'reassignmentNoAgents' || exitType === 'reassignmentError'

    const stateUpdate = this.bp.IO.Event({
      ..._.pick(event, ['botId', 'channel', 'target', 'threadId']),
      direction: 'incoming',
      payload: {
        exitType,
        agentName,
        handoffTransfer: isReassignmentTransfer // Bandera para el bot
      },
      preview: 'none',
      type: 'hitlnext'
    })

    await this.bp.events.sendEvent(stateUpdate)

    this.bp.logger.forBot(event.botId).info('Transfer to bot event sent', {
      exitType,
      target: event.target,
      threadId: event.threadId,
      handoffTransfer: isReassignmentTransfer
    })
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

  /**
   * Close a handoff completely and return the conversation to the bot
   */
  private async closeHandoffAndReturnToBot(
    botId: string,
    handoff: IHandoff,
    exitType: ExitTypes,
    originalAgentName?: string
  ) {
    try {
      // Close the handoff completely
      const resolvedHandoff = await this.repository.updateHandoff(botId, handoff.id, {
        status: 'resolved',
        resolvedAt: new Date(),
        agentId: null,
        agentThreadId: null
      })

      // Clear all handoff caches
      this.state.expireHandoff(botId, handoff.userThreadId)
      if (handoff.agentThreadId) {
        this.state.expireHandoff(botId, handoff.agentThreadId)
      }

      this.bp.logger.forBot(botId).info(`Closed handoff ${handoff.id} and cleared caches`, { exitType })

      // Update realtime to show handoff as resolved
      this.updateRealtimeHandoff(botId, resolvedHandoff)

      // Clear user cache and dialog session to ensure clean exit from HitlNext flow
      await this.clearUserCache(botId, handoff)

      // Transfer to bot (this will trigger the dialog engine to resume)
      const eventDestination = toEventDestination(botId, handoff)
      await this.transferToBot(eventDestination, exitType, originalAgentName)

      this.bp.logger.forBot(botId).info(`Successfully returned conversation ${handoff.id} to bot`, { exitType })
    } catch (error) {
      this.bp.logger.forBot(botId).error(`Failed to close handoff ${handoff.id} and return to bot:`, error.message)
      throw error
    }
  }

  /**
   * Reassign a single conversation to a specific agent (individual reassignment)
   * This is different from bulk reassignment and does not change agent status
   */
  async reassignSingleConversation(botId: string, handoff: IHandoff, currentAgentId: string, targetAgentId: string) {
    try {
      this.bp.logger
        .forBot(botId)
        .info(
          `Starting individual reassignment of handoff ${handoff.id} from agent ${currentAgentId} to agent ${targetAgentId}`
        )

      // Get current agent info for messaging
      const currentAgent = await this.repository.getAgent(currentAgentId)
      const currentAgentName = currentAgent?.attributes?.firstname || currentAgent?.attributes?.email || 'un agente'

      const config: Config = await this.bp.config.getModuleConfigForBot(MODULE_NAME, botId)

      // Send initial reassignment message to user only if enabled
      if (config.transferMessageEnabled) {
        const eventDestination = toEventDestination(botId, handoff)
        const attributes = await this.bp.users.getAttributes(handoff.userChannel, handoff.userId)
        const language = attributes.language

        const reassignMessage = config.reassignMessage || {
          en:
            'Agent {{agentName}} has reassigned your conversation. We are looking for another available agent, please wait a moment.',
          es:
            'El agente {{agentName}} ha reasignado su conversación. Estamos buscando otro agente disponible, por favor espere un momento.'
        }

        await this.sendMessageToUser(reassignMessage, eventDestination, language, {
          agentName: currentAgentName
        })
      }

      // Unassign the conversation temporarily
      const unassignedHandoff = await this.repository.unassignHandoff(botId, handoff.id)

      // Clear the original agent thread cache only
      if (handoff.agentThreadId) {
        this.state.expireHandoff(botId, handoff.agentThreadId)
      }

      // Small delay to make the process feel natural
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Get target agent
      const targetAgent = await this.repository.getAgent(targetAgentId)

      // Create new agent conversation for target agent
      const userId = await this.repository.mapVisitor(botId, targetAgentId)
      const conversation = await this.bp.messaging.forBot(botId).createConversation(userId)

      const agentThreadId = conversation.id
      const payload: Pick<IHandoff, 'agentId' | 'agentThreadId' | 'assignedAt' | 'status'> = {
        agentId: targetAgentId,
        agentThreadId,
        assignedAt: new Date(),
        status: 'assigned'
      }

      // Update handoff with new assignment
      const updatedHandoff = await this.repository.updateHandoff(botId, handoff.id, payload)

      // Cache the handoff for both threads
      this.state.cacheHandoff(botId, updatedHandoff.userThreadId, updatedHandoff)
      this.state.cacheHandoff(botId, agentThreadId, updatedHandoff)

      // Copy conversation history to new agent thread
      await this.copyConversationHistory(botId, handoff, agentThreadId, userId)

      // Send success message to user only if enabled
      if (config.transferMessageEnabled) {
        const eventDestination = toEventDestination(botId, handoff)
        const attributes = await this.bp.users.getAttributes(handoff.userChannel, handoff.userId)
        const language = attributes.language

        const targetAgentName = targetAgent.attributes?.firstname || targetAgent.attributes?.email || 'nuevo agente'

        const reassignSuccessMessage = config.reassignSuccessMessage || {
          en: 'Your conversation has been reassigned to agent {{agentName}}.',
          es: 'Su conversación ha sido reasignada al agente {{agentName}}.'
        }

        await this.sendMessageToUser(reassignSuccessMessage, eventDestination, language, {
          agentName: targetAgentName
        })
      }

      // Update realtime
      this.updateRealtimeHandoff(botId, updatedHandoff)

      this.bp.logger.forBot(botId).info(`Successfully reassigned handoff ${handoff.id} to agent ${targetAgentId}`)
    } catch (error) {
      this.bp.logger.forBot(botId).error(`Failed to reassign single conversation ${handoff.id}:`, error.message)
      throw error
    }
  }
}

export default Service
