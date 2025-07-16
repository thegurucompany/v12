import Bluebird from 'bluebird'
import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import { SDK } from '.'
import { HitlSession, HitlSessionOverview, Message, SessionIdentity } from './typings'

// trims SQL queries from objects
const toPlainObject = object =>
  _.mapValues(object, v => {
    return v && v.sql ? v.sql : v
  })

export const TABLE_NAME_SESSIONS = 'hitl_sessions'
export const TABLE_NAME_MESSAGES = 'hitl_messages'

export default class HitlDb {
  knex: any

  constructor(private bp: SDK) {
    this.knex = bp.database
  }

  initialize() {
    if (!this.knex) {
      throw new Error('you must initialize the database before')
    }

    return this.knex
      .createTableIfNotExists(TABLE_NAME_SESSIONS, function(table) {
        table.increments('id').primary()
        table.string('botId').notNullable()
        table.string('channel')
        table.string('userId')
        table.string('full_name')
        table.string('user_image_url')
        table.timestamp('last_event_on')
        table.timestamp('last_heard_on')
        table.boolean('paused')
        table.string('paused_trigger')
        table.string('thread_id')
      })
      .then(() => {
        return this.knex.createTableIfNotExists(TABLE_NAME_MESSAGES, function(table) {
          table.increments('id').primary()
          table
            .integer('session_id')
            .references(`${TABLE_NAME_SESSIONS}.id`)
            .onDelete('CASCADE')
          table.string('type')
          table.string('source')
          table.string('text', 640)
          table.jsonb('raw_message')
          table.enu('direction', ['in', 'out'])
          table.timestamp('ts')
        })
      })
      .then(() =>
        this.knex(TABLE_NAME_MESSAGES)
          .columnInfo('text')
          .then(info => {
            if (info.maxLength === null || this.knex.isLite) {
              return
            }

            return this.knex.schema.alterTable(TABLE_NAME_MESSAGES, table => {
              table.text('text', 'longtext').alter()
            })
          })
      )
  }

  createUserSession = async (event: sdk.IO.Event) => {
    this.bp.logger.info('=== CREAR NUEVA SESIÓN HITL ===')
    this.bp.logger.info('Event completo:', JSON.stringify(event, null, 2))

    let profileUrl = undefined
    let displayName = `# ${Math.random()
      .toString()
      .substr(2)}`

    const user: sdk.User = (await this.bp.users.getOrCreateUser(event.channel, event.target, event.botId)).result
    this.bp.logger.info('Usuario obtenido/creado:', JSON.stringify(user, null, 2))

    if (user && user.attributes) {
      const { first_name, last_name, full_name, profile_pic, picture_url } = user.attributes

      profileUrl = profile_pic || picture_url
      displayName = full_name || (first_name && last_name && `${first_name} ${last_name}`) || displayName

      // También revisar webchatCustomId para nombres
      if (user.attributes.webchatCustomId) {
        const { firstName, lastName } = user.attributes.webchatCustomId
        if (displayName.startsWith('#') && (firstName || lastName)) {
          displayName = firstName && lastName ? `${firstName} ${lastName}` : (firstName || lastName || displayName)
        }
      }

      this.bp.logger.info('DisplayName después de atributos:', displayName)
    }

    // Si no hay nombre del usuario, intentar usar identificadores específicos del canal
    if (!user?.attributes?.full_name && !user?.attributes?.first_name && !user?.attributes?.webchatCustomId?.firstName) {
      this.bp.logger.info('No se encontró nombre, buscando identificadores por canal...')
      try {
        if (event.channel === 'whatsapp' || event.channel === 'vonage') {
          this.bp.logger.info(`Canal detectado como WhatsApp/Vonage: ${event.channel}`)
          const whatsappNumber = await this.getWhatsAppNumber(event)
          if (whatsappNumber) {
            displayName = `+${whatsappNumber}`
          }
        } else if (event.channel === 'web') {
          const webIdentifier = await this.getWebUserIdentifier(event, user)
          if (webIdentifier) {
            displayName = webIdentifier
          }
        }
      } catch (error) {
        this.bp.logger.warn(`Error obteniendo identificador para canal ${event.channel} en HITL:`, error.message)
      }
    }

    this.bp.logger.info('DisplayName final:', displayName)
    this.bp.logger.info('=== FIN CREAR SESIÓN ===')

    const session = {
      botId: event.botId,
      channel: event.channel,
      userId: event.target,
      thread_id: event.threadId,
      user_image_url: profileUrl,
      last_event_on: this.knex.date.now(),
      last_heard_on: this.knex.date.now(),
      paused: 0,
      full_name: displayName,
      paused_trigger: undefined
    }

    const dbSession = await this.knex.insertAndRetrieve(TABLE_NAME_SESSIONS, session, '*')

    return { is_new_session: true, ...dbSession }
  }

  async getOrCreateUserSession(event: sdk.IO.Event) {
    if (!event.target) {
      return undefined
    }

    const where = { botId: event.botId, channel: event.channel, userId: event.target }
    if (event.threadId) {
      where['thread_id'] = event.threadId
    }

    return this.knex(TABLE_NAME_SESSIONS)
      .where(where)
      .select('*')
      .limit(1)
      .then(async users => {
        if (!users || users.length === 0) {
          return this.createUserSession(event)
        } else {
          const existingSession = users[0]

          // Si la sesión existe pero tiene un nombre genérico (#...), actualizar con identificador específico del canal
          if (existingSession.full_name && existingSession.full_name.startsWith('#')) {
            try {
              let newDisplayName = null

              if (event.channel === 'whatsapp' || event.channel === 'vonage') {
                const whatsappNumber = await this.getWhatsAppNumber(event)
                if (whatsappNumber) {
                  newDisplayName = `+${whatsappNumber}`
                }
              } else if (event.channel === 'web') {
                const user = (await this.bp.users.getOrCreateUser(event.channel, event.target, event.botId)).result
                const webIdentifier = await this.getWebUserIdentifier(event, user)
                if (webIdentifier) {
                  newDisplayName = webIdentifier
                }
              }

              if (newDisplayName) {
                await this.knex(TABLE_NAME_SESSIONS)
                  .where({ id: existingSession.id })
                  .update({ full_name: newDisplayName })

                existingSession.full_name = newDisplayName
                this.bp.logger.info(`Nombre de sesión HITL actualizado para canal ${event.channel}:`, newDisplayName)
              }
            } catch (error) {
              this.bp.logger.warn('Error actualizando nombre de sesión HITL:', error.message)
            }
          }

          return existingSession
        }
      })
  }

  async getSessionById(sessionId: string): Promise<HitlSession | undefined> {
    return this.knex(TABLE_NAME_SESSIONS)
      .where({ id: sessionId })
      .select('*')
      .get(0)
      .then(
        res =>
          res && {
            id: res.id,
            botId: res.botId,
            channel: res.channel,
            userId: res.userId,
            threadId: res.thread_id,
            fullName: res.full_name,
            profileUrl: res.user_image_url,
            lastEventOn: res.last_event_on,
            lastHeardOn: res.last_heard_on,
            isPaused: res.paused,
            pausedBy: res.paused_trigger
          }
      )
  }

  buildUpdate = direction => {
    const now = this.knex.date.now()
    return direction === 'in'
      ? { last_event_on: now }
      : {
          last_event_on: now,
          last_heard_on: now
        }
  }

  async appendMessageToSession(event: sdk.IO.Event, sessionId: string, direction: string) {
    const payload = event.payload || {}
    const text = event.preview || payload.text || (payload.wrapped && payload.wrapped.text)

    let source = 'user'
    if (direction === 'out') {
      source = event.payload.agent ? 'agent' : 'bot'
    }

    const message = {
      session_id: sessionId,
      type: event.type,
      raw_message: event.payload,
      text,
      source,
      direction,
      ts: new Date()
    }

    return Bluebird.join(
      this.knex(TABLE_NAME_MESSAGES).insert({
        ...message,
        raw_message: this.knex.json.set(message.raw_message || {}),
        ts: this.knex.date.now()
      }),
      this.knex(TABLE_NAME_SESSIONS)
        .where({ id: sessionId })
        .update(this.buildUpdate(direction)),
      () => toPlainObject(message)
    )
  }

  async setSessionPauseState(isPaused: boolean, session: SessionIdentity, trigger: string): Promise<number> {
    const { botId, channel, userId, sessionId, threadId } = session

    if (sessionId) {
      return this.knex(TABLE_NAME_SESSIONS)
        .where({ id: sessionId })
        .update({ paused: isPaused ? 1 : 0, paused_trigger: trigger })
        .then(() => parseInt(sessionId))
    } else {
      const where = { botId, channel, userId }
      if (threadId) {
        where['thread_id'] = threadId
      }
      return this.knex(TABLE_NAME_SESSIONS)
        .where(where)
        .update({ paused: isPaused ? 1 : 0, paused_trigger: trigger })
        .then(() => {
          return this.knex(TABLE_NAME_SESSIONS)
            .where(where)
            .select('id')
        })
        .then(sessions => parseInt(sessions[0].id))
    }
  }

  async isSessionPaused(session: SessionIdentity): Promise<boolean> {
    const { botId, channel, userId, sessionId, threadId } = session

    const toBool = s => this.knex.bool.parse(s)
    return this.knex(TABLE_NAME_SESSIONS)
      .where(sessionId ? { id: sessionId } : { botId, channel, userId, threadId })
      .select('paused')
      .then()
      .get(0)
      .then(s => s && toBool(s.paused))
  }

  async getAllSessions(
    onlyPaused: boolean,
    botId: string,
    sessionIds?: string[]
  ): Promise<{ total: number; sessions: HitlSessionOverview[] }> {
    const knex2 = this.knex

    let query = this.knex
      .select('*')
      .from(function() {
        this.select([knex2.raw('max(id) as mId'), 'session_id', knex2.raw('count(*) as count')])
          .from(TABLE_NAME_MESSAGES)
          .groupBy('session_id')
          .as('q1')
      })
      .join(TABLE_NAME_MESSAGES, this.knex.raw('q1.mId'), `${TABLE_NAME_MESSAGES}.id`)
      .join(TABLE_NAME_SESSIONS, this.knex.raw('q1.session_id'), `${TABLE_NAME_SESSIONS}.id`)
      .join('srv_channel_users', this.knex.raw('srv_channel_users.user_id'), `${TABLE_NAME_SESSIONS}.userId`)
      .where({ botId })

    if (onlyPaused) {
      query = query.whereRaw(`${TABLE_NAME_SESSIONS}.paused = ${this.knex.bool.true()}`)
    }

    if (sessionIds) {
      query = query.whereIn(`${TABLE_NAME_SESSIONS}.id`, sessionIds)
    }

    return query
      .orderBy(`${TABLE_NAME_SESSIONS}.last_event_on`, 'desc')
      .limit(100)
      .then(results =>
        results.map(res => ({
          id: res.session_id,
          botId: res.botId,
          channel: res.channel,
          threadId: res.thread_id,
          lastEventOn: res.last_event_on,
          lastHeardOn: res.last_heard_on,
          isPaused: res.paused,
          pausedBy: res.paused_trigger,
          lastMessage: {
            id: res.mId,
            type: res.type,
            source: res.source,
            text: res.text,
            raw_message: res.raw_message,
            direction: res.direction,
            ts: res.ts
          },
          user: {
            id: res.userId,
            fullName: res.full_name,
            avatarUrl: res.user_image_url,
            attributes: this.knex.json.get(res.attributes)
          }
        }))
      )
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    return this.knex
      .orderBy('ts', 'asc')
      .select('*')
      .from(function() {
        this.from(TABLE_NAME_MESSAGES)
          .where({ session_id: sessionId })
          .orderBy('ts', 'desc')
          .limit(100)
          .select('*')
          .as('q1')
      })
      .then(messages =>
        messages.map(msg => ({
          ...msg,
          raw_message: this.knex.json.get(msg.raw_message)
        }))
      )
  }

  async searchSessions(searchTerm: string): Promise<string[]> {
    const query = this.knex(TABLE_NAME_SESSIONS)
      .join('srv_channel_users', this.knex.raw('srv_channel_users.user_id'), `${TABLE_NAME_SESSIONS}.userId`)
      .where('full_name', 'like', `%${searchTerm}%`)
      .orWhere('srv_channel_users.user_id', 'like', `%${searchTerm}%`)

    if (this.knex.isLite) {
      query.orWhere('attr_fullName', 'like', `%${searchTerm}%`)
      query.select(
        this.knex.raw(
          `${TABLE_NAME_SESSIONS}.id, json_extract(srv_channel_users.attributes, '$.full_name') as attr_fullName`
        )
      )
    } else {
      query.orWhereRaw(`srv_channel_users.attributes ->>'full_name' like '%${searchTerm}%'`)
      query.select(this.knex.raw(`${TABLE_NAME_SESSIONS}.id`))
    }

    return query
      .orderBy('last_heard_on')
      .limit(100)
      .then(results => results.map(r => r.id))
  }

  // Método para obtener el número de WhatsApp del usuario
  private async getWhatsAppNumber(event: sdk.IO.Event): Promise<string | null> {
    try {
      this.bp.logger.info('=== DEBUG HITL WhatsApp/Vonage User ===')
      this.bp.logger.info('Event completo:', JSON.stringify(event, null, 2))

      const conversationId = event.threadId
      const botId = event.botId
      this.bp.logger.info('ConversationId:', conversationId)
      this.bp.logger.info('BotId:', botId)

      const messaging = this.bp.messaging.forBot(botId)
      this.bp.logger.info('Messaging instance obtenida')

      const endpoints = await messaging.listEndpoints(conversationId)
      this.bp.logger.info('Endpoints encontrados:', JSON.stringify(endpoints, null, 2))

      const endpoint = endpoints[0]

      let mosiMobilePhone = ''
      if (!endpoint) {
        this.bp.logger.info('No se encontró endpoint, usando número por defecto')
        // Número por defecto si no se encuentra endpoint
        mosiMobilePhone = '525538560042'
      } else {
        this.bp.logger.info('Endpoint encontrado:', JSON.stringify(endpoint, null, 2))
        mosiMobilePhone = endpoint.sender
        this.bp.logger.info('Número extraído del endpoint:', mosiMobilePhone)
      }

      // Función para quitar los primeros dos números
      const removeFirstTwoNumbers = (numbers: string): string => {
        if (numbers.length >= 2) {
          return numbers.substring(2)
        }
        return ''
      }

      const userMsisdn = removeFirstTwoNumbers(mosiMobilePhone)
      this.bp.logger.info('Número del usuario para HITL (después de procesar):', userMsisdn)
      this.bp.logger.info('=== FIN DEBUG HITL WhatsApp ===')

      return userMsisdn
    } catch (error) {
      this.bp.logger.error('Error obteniendo número de WhatsApp:', error)
      return null
    }
  }  // Método para obtener identificador de usuario web (msisdn o email)
  private async getWebUserIdentifier(event: sdk.IO.Event, user: sdk.User): Promise<string | null> {
    try {
      this.bp.logger.info('=== DEBUG HITL Web User ===')
      this.bp.logger.info('Event target (userId):', event.target)
      this.bp.logger.info('Event channel:', event.channel)
      this.bp.logger.info('User objeto completo:', JSON.stringify(user, null, 2))

      // Primero intentar obtener de los atributos del usuario
      if (user && user.attributes) {
        this.bp.logger.info('User attributes:', JSON.stringify(user.attributes, null, 2))

        // Buscar en webchatCustomId (donde se almacenan los datos del userId del webchat)
        if (user.attributes.webchatCustomId) {
          const { msisdn, email, firstName, lastName } = user.attributes.webchatCustomId

          if (msisdn) {
            this.bp.logger.info('MSISDN encontrado en webchatCustomId para HITL:', msisdn)
            return `+${msisdn}`
          }

          if (email) {
            this.bp.logger.info('Email encontrado en webchatCustomId para HITL:', email)
            return email
          }

          // También verificar si firstName y lastName están disponibles
          if (firstName && lastName) {
            this.bp.logger.info('Nombre completo encontrado en webchatCustomId:', `${firstName} ${lastName}`)
            return `${firstName} ${lastName}`
          }

          if (firstName) {
            this.bp.logger.info('Nombre encontrado en webchatCustomId:', firstName)
            return firstName
          }
        }

        // Fallback: buscar directamente en atributos (por si acaso)
        const { msisdn, email, firstName, lastName } = user.attributes

        if (msisdn) {
          this.bp.logger.info('MSISDN encontrado en atributos directos para HITL:', msisdn)
          return `+${msisdn}`
        }

        if (email) {
          this.bp.logger.info('Email encontrado en atributos directos para HITL:', email)
          return email
        }

        if (firstName && lastName) {
          this.bp.logger.info('Nombre completo encontrado en atributos directos:', `${firstName} ${lastName}`)
          return `${firstName} ${lastName}`
        }
      }

      // Si no está en atributos, intentar obtener del userId del evento
      try {
        const userId = event.target
        if (userId && typeof userId === 'string') {
          this.bp.logger.info('Intentando parsear userId:', userId)

          // Intentar parsear si el userId contiene JSON
          if (userId.startsWith('{')) {
            const parsedUserId = JSON.parse(userId)
            this.bp.logger.info('UserId parseado:', JSON.stringify(parsedUserId, null, 2))

            if (parsedUserId.msisdn) {
              this.bp.logger.info('MSISDN encontrado en userId para HITL:', parsedUserId.msisdn)
              return `+${parsedUserId.msisdn}`
            }
            if (parsedUserId.email) {
              this.bp.logger.info('Email encontrado en userId para HITL:', parsedUserId.email)
              return parsedUserId.email
            }
          }
        }
      } catch (parseError) {
        this.bp.logger.debug('No se pudo parsear userId como JSON:', parseError.message)
      }

      this.bp.logger.info('No se encontró msisdn ni email para usuario web')
      this.bp.logger.info('=== FIN DEBUG HITL ===')
      return null
    } catch (error) {
      this.bp.logger.error('Error obteniendo identificador de usuario web:', error)
      return null
    }
  }
}
