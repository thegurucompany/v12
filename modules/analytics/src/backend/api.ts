import * as sdk from 'botpress/sdk'
import { asyncMiddleware as asyncMw, StandardError } from 'common/http'
import _ from 'lodash'
import moment from 'moment'

import Database from './db'

const getCustomMetricName = (name: string) => {
  if (name.startsWith('cm_')) {
    return name
  }

  return `cm_${name}`
}

export default (bp: typeof sdk, db: Database) => {
  const asyncMiddleware = asyncMw(bp.logger)
  const router = bp.http.createRouterForBot('analytics')

  router.get(
    '/channel/:channel',
    asyncMiddleware(async (req, res) => {
      const { botId, channel } = req.params
      const { start, end } = req.query

      try {
        const startDate = unixToDate(start)
        const endDate = unixToDate(end)
        const metrics = await db.getMetrics(botId, { startDate, endDate, channel })
        res.send({ metrics })
      } catch (err) {
        throw new StandardError('Cannot get analytics', err)
      }
    })
  )

  router.get('/custom_metrics/:name', async (req, res) => {
    try {
      const { botId, name } = req.params
      const { start, end } = req.query

      const startDate = start ? moment(start).toDate() : moment().toDate()
      const endDate = end ? moment(end).toDate() : moment().toDate()

      const metrics = await db.getMetric(botId, '', getCustomMetricName(name), {
        startDate,
        endDate
      })
      res.send({ success: true, metrics })
    } catch (err) {
      res.send({ success: false, message: err.message })
    }
  })

  router.post('/custom_metrics/:name/:method', async (req, res) => {
    try {
      const { botId, method, name } = req.params
      const { count, date } = req.body

      switch (method) {
        case 'increment':
          db.incrementMetric(botId, '', getCustomMetricName(name))
          break
        case 'decrement':
          db.decrementMetric(botId, '', getCustomMetricName(name))
          break
        case 'set':
          const metricDate = date ? moment(date).toDate() : moment().toDate()
          await db.setMetric(botId, '', getCustomMetricName(name), { count, date: metricDate })
          break
        default:
          res.send({ success: false, message: 'Invalid method, use increment, decrement or set' })
          return
      }

      res.send({ success: true })
    } catch (err) {
      res.send({ success: false, message: err.message })
    }
  })

  router.post('/generate-report', asyncMiddleware(async (req, res) => {
    const { botId } = req.params
    const { reportDate } = req.body

    if (!reportDate) {
      throw new StandardError('Report date is required', { statusCode: 400 })
    }

    try {
      const reports = await generateBotReports(db, botId, reportDate)
      res.send({ success: true, reports })
    } catch (err) {
      throw new StandardError('Cannot generate reports', err)
    }
  }))

  const generateBotReports = async (db: Database, botId: string, reportDate: string) => {
    const startDate = moment(reportDate).startOf('day').toISOString()
    const endDate = moment(reportDate).endOf('day').toISOString()

    const reports = []

    // 1. Resumen general
    const totalEvents = await db.knex.raw(`
      SELECT COUNT(*) as total_events,
             COUNT(CASE WHEN direction = 'incoming' THEN 1 END) as incoming_messages,
             COUNT(CASE WHEN direction = 'outgoing' THEN 1 END) as outgoing_messages
      FROM events 
      WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ?
    `, [botId, startDate, endDate])

    const totalEventsData = totalEvents.rows?.[0] || totalEvents[0] || {}

    reports.push({
      name: '00_resumen_general.txt',
      content: `Resumen General - ${reportDate}
Bot: ${botId}
Fecha: ${reportDate}

Total de eventos: ${totalEventsData.total_events || 0}
Mensajes entrantes: ${totalEventsData.incoming_messages || 0}
Mensajes salientes: ${totalEventsData.outgoing_messages || 0}
`
    })

    // 2. Mensajes detallados
    const detailedMessages = await db.knex.raw(`
      SELECT 
        id as event_id,
        channel,
        "threadId" as conversation_id,
        target as user_id,
        type as message_type,
        direction,
        CASE 
          WHEN direction = 'incoming' THEN 'Usuario'
          ELSE 'Bot'
        END as sender,
        json_extract(event, '$.payload.text') as message_text,
        "createdOn" as timestamp
      FROM events
      WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ?
      ORDER BY "createdOn" ASC
    `, [botId, startDate, endDate])

    reports.push({
      name: '01_mensajes_detallados.csv',
      content: convertToCSV(detailedMessages.rows || detailedMessages, ['event_id', 'channel', 'conversation_id', 'user_id', 'message_type', 'direction', 'sender', 'message_text', 'timestamp'])
    })

    // 3. Resumen de conversaciones
    const conversationsSummary = await db.knex.raw(`
      SELECT 
        "threadId" as conversation_id,
        target as user_id,
        channel,
        MIN("createdOn") as conversation_start,
        MAX("createdOn") as conversation_end,
        COUNT(*) as total_messages,
        COUNT(CASE WHEN direction = 'incoming' THEN 1 END) as user_messages,
        COUNT(CASE WHEN direction = 'outgoing' THEN 1 END) as bot_messages
      FROM events
      WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ?
      AND "threadId" IS NOT NULL
      GROUP BY "threadId", target, channel
      ORDER BY conversation_start ASC
    `, [botId, startDate, endDate])

    reports.push({
      name: '02_resumen_conversaciones.csv',
      content: convertToCSV(conversationsSummary.rows || conversationsSummary, ['conversation_id', 'user_id', 'channel', 'conversation_start', 'conversation_end', 'total_messages', 'user_messages', 'bot_messages'])
    })

    // 4. Estadísticas por hora
    const hourlyStats = await db.knex.raw(`
      SELECT 
        CAST(strftime('%H', "createdOn") AS INTEGER) as hour_of_day,
        COUNT(*) as total_messages,
        COUNT(CASE WHEN direction = 'incoming' THEN 1 END) as incoming_messages,
        COUNT(CASE WHEN direction = 'outgoing' THEN 1 END) as outgoing_messages
      FROM events
      WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ?
      GROUP BY strftime('%H', "createdOn")
      ORDER BY hour_of_day ASC
    `, [botId, startDate, endDate])

    reports.push({
      name: '03_estadisticas_por_hora.csv',
      content: convertToCSV(hourlyStats.rows || hourlyStats, ['hour_of_day', 'total_messages', 'incoming_messages', 'outgoing_messages'])
    })

    // 5. Tipos de mensaje
    const messageTypes = await db.knex.raw(`
      SELECT 
        type as message_type,
        direction,
        COUNT(*) as count
      FROM events
      WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ?
      GROUP BY type, direction
      ORDER BY count DESC
    `, [botId, startDate, endDate])

    reports.push({
      name: '04_tipos_de_mensaje.csv',
      content: convertToCSV(messageTypes.rows || messageTypes, ['message_type', 'direction', 'count'])
    })

    // 6. Usuarios activos
    const activeUsers = await db.knex.raw(`
      SELECT 
        target as user_id,
        channel,
        COUNT(*) as total_messages,
        COUNT(CASE WHEN direction = 'incoming' THEN 1 END) as messages_sent,
        COUNT(CASE WHEN direction = 'outgoing' THEN 1 END) as messages_received,
        MIN("createdOn") as first_interaction,
        MAX("createdOn") as last_interaction
      FROM events
      WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ?
      AND target IS NOT NULL
      GROUP BY target, channel
      ORDER BY total_messages DESC
    `, [botId, startDate, endDate])

    reports.push({
      name: '05_usuarios_activos.csv',
      content: convertToCSV(activeUsers.rows || activeUsers, ['user_id', 'channel', 'total_messages', 'messages_sent', 'messages_received', 'first_interaction', 'last_interaction'])
    })

    // 7. Handoffs detallados (si existe la tabla)
    try {
      const handoffs = await db.knex.raw(`
        SELECT 
          id,
          "botId",
          "userThreadId" as thread_id,
          "agentId" as agent_id,
          status,
          "assignedAt",
          "resolvedAt",
          "createdAt"
        FROM hitl_sessions
        WHERE "botId" = ? AND "createdAt" >= ? AND "createdAt" <= ?
        ORDER BY "createdAt" ASC
      `, [botId, startDate, endDate])

      reports.push({
        name: '06_handoffs_detallados.csv',
        content: convertToCSV(handoffs.rows || handoffs, ['id', 'botId', 'thread_id', 'agent_id', 'status', 'assignedAt', 'resolvedAt', 'createdAt'])
      })
    } catch (err) {
      // Si no existe la tabla hitl_sessions, crear un archivo vacío
      reports.push({
        name: '06_handoffs_detallados.csv',
        content: 'id,botId,thread_id,agent_id,status,assignedAt,resolvedAt,createdAt\n'
      })
    }

    // 8. Análisis completo en markdown
    const analysisContent = `# Análisis Completo - ${reportDate}

## Bot: ${botId}
## Fecha: ${reportDate}

### Resumen Ejecutivo
- **Total de eventos**: ${totalEventsData.total_events || 0}
- **Mensajes entrantes**: ${totalEventsData.incoming_messages || 0}
- **Mensajes salientes**: ${totalEventsData.outgoing_messages || 0}
- **Conversaciones únicas**: ${(conversationsSummary.rows || conversationsSummary).length || 0}
- **Usuarios únicos**: ${(activeUsers.rows || activeUsers).length || 0}

### Archivos Generados
1. **00_resumen_general.txt** - Resumen básico de métricas
2. **01_mensajes_detallados.csv** - Todos los mensajes del día
3. **02_resumen_conversaciones.csv** - Agrupación por conversación
4. **03_estadisticas_por_hora.csv** - Distribución temporal
5. **04_tipos_de_mensaje.csv** - Análisis por tipo de mensaje
6. **05_usuarios_activos.csv** - Actividad por usuario
7. **06_handoffs_detallados.csv** - Datos de Human in the Loop

Reporte generado el: ${new Date().toISOString()}
`

    reports.push({
      name: 'ANALISIS_COMPLETO.md',
      content: analysisContent
    })

    return reports
  }

  const convertToCSV = (data: any[], headers: string[]) => {
    if (!data || data.length === 0) {
      return headers.join(',') + '\n'
    }

    const csvRows = [headers.join(',')]
    
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header]
        if (value === null || value === undefined) {
          return ''
        }
        // Escapar comillas dobles y envolver en comillas si contiene comas
        const stringValue = String(value)
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`
        }
        return stringValue
      })
      csvRows.push(values.join(','))
    }

    return csvRows.join('\n')
  }

  const unixToDate = unix => {
    const momentDate = moment.unix(unix)
    if (!momentDate.isValid()) {
      throw new Error(`Invalid unix timestamp format ${unix}.`)
    }

    return moment.utc(momentDate.format('YYYY-MM-DD')).toDate()
  }
}
