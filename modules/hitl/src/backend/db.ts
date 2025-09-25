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
export const TABLE_NAME_USER_IDENTIFICATION = 'user_identification'

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
        table.enu('sentiment', ['positivo', 'negativo', 'neutro']).defaultTo('neutro')
        table.jsonb('tags').defaultTo('[]')
        table.boolean('issue_resolved').defaultTo(false)
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
      .then(() => {
        return this.knex.createTableIfNotExists(TABLE_NAME_USER_IDENTIFICATION, table => {
          table.increments('id').primary()
          table.string('number').notNullable()
          table.string('user_type').notNullable()
          table.timestamps(true, true)
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
    let profileUrl = undefined
    let displayName = `# ${Math.random()
      .toString()
      .substr(2)}`

    const user: sdk.User = (await this.bp.users.getOrCreateUser(event.channel, event.target, event.botId)).result

    if (user && user.attributes) {
      const { first_name, last_name, full_name, profile_pic, picture_url } = user.attributes

      profileUrl = profile_pic || picture_url
      displayName = full_name || (first_name && last_name && `${first_name} ${last_name}`) || displayName

      if (user.attributes.webchatCustomId) {
        const { firstName, lastName } = user.attributes.webchatCustomId
        if (displayName.startsWith('#') && (firstName || lastName)) {
          displayName = firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || displayName
        }
      }
    }

    if (
      !user?.attributes?.full_name &&
      !user?.attributes?.first_name &&
      !user?.attributes?.webchatCustomId?.firstName
    ) {
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

    try {
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
                }
              } catch (error) {
                this.bp.logger.warn('Error actualizando nombre de sesión HITL:', error.message)
              }
            }

            return existingSession
          }
        })
    } catch (error) {
      this.bp.logger.error('Error in getOrCreateUserSession:', error)
      return undefined
    }
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
    try {
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
    } catch (error) {
      this.bp.logger.error('Error appending message to session:', error)
      throw error
    }
  }

  async setSessionPauseState(isPaused: boolean, session: SessionIdentity, trigger: string): Promise<number> {
    try {
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
    } catch (error) {
      this.bp.logger.error('Error setting session pause state:', error)
      throw error
    }
  }

  async isSessionPaused(session: SessionIdentity): Promise<boolean> {
    try {
      const { botId, channel, userId, sessionId, threadId } = session

      const toBool = s => this.knex.bool.parse(s)
      return this.knex(TABLE_NAME_SESSIONS)
        .where(sessionId ? { id: sessionId } : { botId, channel, userId, threadId })
        .select('paused')
        .then()
        .get(0)
        .then(s => s && toBool(s.paused))
    } catch (error) {
      this.bp.logger.error('Error checking if session is paused:', error)
      return false
    }
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
          sentiment: res.sentiment,
          tags: this.parseTags(res.tags),
          issueResolved: res.issue_resolved,
          userType: res.user_type,
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
    // Validar que sessionId no sea undefined o null
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
      this.bp.logger.warn('getSessionMessages: sessionId inválido:', sessionId)
      return []
    }

    try {
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
    } catch (error) {
      this.bp.logger.error('Error en getSessionMessages:', error)
      return []
    }
  }

  async searchSessions(searchTerm: string): Promise<string[]> {
    try {
      const cleanSearchTerm = searchTerm.trim()
      if (!cleanSearchTerm) {
        return []
      }

      let query = this.knex(TABLE_NAME_SESSIONS)
        .where('full_name', 'like', `%${cleanSearchTerm}%`)
        .orWhere('userId', 'like', `%${cleanSearchTerm}%`)

      if (cleanSearchTerm.match(/^\+?\d+$/)) {
        const numberOnly = cleanSearchTerm.replace(/^\+/, '')
        query = query.orWhere('full_name', 'like', `%${numberOnly}%`).orWhere('full_name', 'like', `%+${numberOnly}%`)
      }

      try {
        const tableExists = await this.knex.schema.hasTable('srv_channel_users')

        if (tableExists) {
          if (this.knex.isLite) {
            query = query
              .leftJoin('srv_channel_users', function() {
                this.on('srv_channel_users.user_id', '=', `${TABLE_NAME_SESSIONS}.userId`).andOn(
                  'srv_channel_users.channel',
                  '=',
                  `${TABLE_NAME_SESSIONS}.channel`
                )
              })
              .orWhere('srv_channel_users.user_id', 'like', `%${cleanSearchTerm}%`)

            if (cleanSearchTerm.length > 2) {
              query = query.orWhereRaw(
                `json_extract(srv_channel_users.attributes, '$.full_name') like '%${cleanSearchTerm}%'`
              )
              query = query.orWhereRaw(
                `json_extract(srv_channel_users.attributes, '$.webchatCustomId.firstName') like '%${cleanSearchTerm}%'`
              )
              query = query.orWhereRaw(
                `json_extract(srv_channel_users.attributes, '$.webchatCustomId.lastName') like '%${cleanSearchTerm}%'`
              )
              query = query.orWhereRaw(
                `json_extract(srv_channel_users.attributes, '$.webchatCustomId.email') like '%${cleanSearchTerm}%'`
              )
              query = query.orWhereRaw(
                `json_extract(srv_channel_users.attributes, '$.webchatCustomId.msisdn') like '%${cleanSearchTerm}%'`
              )
            }
          } else {
            query = query
              .leftJoin('srv_channel_users', function() {
                this.on('srv_channel_users.user_id', '=', `${TABLE_NAME_SESSIONS}.userId`).andOn(
                  'srv_channel_users.channel',
                  '=',
                  `${TABLE_NAME_SESSIONS}.channel`
                )
              })
              .orWhere('srv_channel_users.user_id', 'like', `%${cleanSearchTerm}%`)

            if (cleanSearchTerm.length > 2) {
              query = query.orWhereRaw(`srv_channel_users.attributes ->>'full_name' ilike '%${cleanSearchTerm}%'`)
              query = query.orWhereRaw(
                `srv_channel_users.attributes ->'webchatCustomId'->>'firstName' ilike '%${cleanSearchTerm}%'`
              )
              query = query.orWhereRaw(
                `srv_channel_users.attributes ->'webchatCustomId'->>'lastName' ilike '%${cleanSearchTerm}%'`
              )
              query = query.orWhereRaw(
                `srv_channel_users.attributes ->'webchatCustomId'->>'email' ilike '%${cleanSearchTerm}%'`
              )
              query = query.orWhereRaw(
                `srv_channel_users.attributes ->'webchatCustomId'->>'msisdn' ilike '%${cleanSearchTerm}%'`
              )
            }
          }
        } else {
          this.bp.logger.warn('Tabla srv_channel_users no existe, búsqueda limitada a sessions')
        }
      } catch (joinError) {
        this.bp.logger.warn('Error al hacer join con srv_channel_users:', joinError.message)
      }

      const results = await query
        .select(`${TABLE_NAME_SESSIONS}.id`, `${TABLE_NAME_SESSIONS}.last_heard_on`)
        .distinct()
        .orderBy(`${TABLE_NAME_SESSIONS}.last_heard_on`, 'desc')
        .limit(100)

      const sessionIds = results.map(r => r.id.toString())

      return sessionIds
    } catch (error) {
      this.bp.logger.error('Error en searchSessions:', error)
      try {
        const fallbackResults = await this.knex(TABLE_NAME_SESSIONS)
          .where('full_name', 'like', `%${searchTerm}%`)
          .select('id')
          .orderBy('last_heard_on', 'desc')
          .limit(100)

        return fallbackResults.map(r => r.id.toString())
      } catch (fallbackError) {
        this.bp.logger.error('Error en búsqueda fallback:', fallbackError)
        return []
      }
    }
  }

  private async getWhatsAppNumber(event: sdk.IO.Event): Promise<string | null> {
    try {
      const conversationId = event.threadId
      const botId = event.botId
      const messaging = this.bp.messaging.forBot(botId)
      const endpoints = await messaging.listEndpoints(conversationId)
      const endpoint = endpoints[0]

      let mosiMobilePhone = ''
      mosiMobilePhone = endpoint.sender
      const removeFirstTwoNumbers = (numbers: string): string => {
        if (numbers.length >= 2) {
          return numbers.substring(2)
        }
        return ''
      }

      const userMsisdn = removeFirstTwoNumbers(mosiMobilePhone)

      return userMsisdn
    } catch (error) {
      return null
    }
  }
  private async getWebUserIdentifier(event: sdk.IO.Event, user: sdk.User): Promise<string | null> {
    try {
      if (user && user.attributes) {
        this.bp.logger.info('User attributes:', JSON.stringify(user.attributes, null, 2))

        if (user.attributes.webchatCustomId) {
          const { msisdn, email, firstName, lastName } = user.attributes.webchatCustomId
          if (msisdn) {
            return `+${msisdn}`
          }
          if (email) {
            return email
          }
          if (firstName && lastName) {
            return `${firstName} ${lastName}`
          }
          if (firstName) {
            return firstName
          }
        }

        const { msisdn, email, firstName, lastName } = user.attributes

        if (msisdn) {
          return `+${msisdn}`
        }

        if (email) {
          return email
        }

        if (firstName && lastName) {
          return `${firstName} ${lastName}`
        }
      }

      try {
        const userId = event.target
        if (userId && typeof userId === 'string') {
          if (userId.startsWith('{')) {
            const parsedUserId = JSON.parse(userId)

            if (parsedUserId.msisdn) {
              return `+${parsedUserId.msisdn}`
            }
            if (parsedUserId.email) {
              return parsedUserId.email
            }
          }
        }
      } catch (parseError) {
        this.bp.logger.debug('No se pudo parsear userId como JSON:', parseError.message)
      }

      return null
    } catch (error) {
      this.bp.logger.error('Error obteniendo identificador de usuario web:', error)
      return null
    }
  }

  private parseTags(tagsValue: any): string[] {
    try {
      if (!tagsValue) {
        return []
      }

      if (typeof tagsValue === 'string') {
        if (tagsValue.trim() === '' || tagsValue.trim() === '[]') {
          return []
        }
        return JSON.parse(tagsValue)
      }

      if (Array.isArray(tagsValue)) {
        return tagsValue
      }

      return []
    } catch (error) {
      this.bp.logger.debug('Error parsing tags:', error.message)
      return []
    }
  }
}
