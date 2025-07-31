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

  router.post(
    '/generate-report',
    asyncMiddleware(async (req, res) => {
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
    })
  )

  const generateBotReports = async (db: Database, botId: string, reportDate: string) => {
    const startDate = moment(reportDate)
      .startOf('day')
      .toISOString()
    const endDate = moment(reportDate)
      .endOf('day')
      .toISOString()

    const reports = []

    // 1. Obtener todas las métricas para el resumen general
    const totalEventsQuery = await db.knex.raw(
      'SELECT COUNT(*) as total_events FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ?',
      [botId, startDate, endDate]
    )
    const totalEvents = (totalEventsQuery.rows?.[0] || totalEventsQuery[0] || {}).total_events || 0

    const uniqueUsersQuery = await db.knex.raw(
      'SELECT COUNT(DISTINCT target) as unique_users FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ? AND target IS NOT NULL',
      [botId, startDate, endDate]
    )
    const uniqueUsers = (uniqueUsersQuery.rows?.[0] || uniqueUsersQuery[0] || {}).unique_users || 0

    const uniqueConversationsQuery = await db.knex.raw(
      'SELECT COUNT(DISTINCT "threadId") as unique_conversations FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ? AND "threadId" IS NOT NULL',
      [botId, startDate, endDate]
    )
    const uniqueConversations =
      (uniqueConversationsQuery.rows?.[0] || uniqueConversationsQuery[0] || {}).unique_conversations || 0

    const userMessagesQuery = await db.knex.raw(
      'SELECT COUNT(*) as user_messages FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ? AND direction = \'incoming\'',
      [botId, startDate, endDate]
    )
    const userMessages = (userMessagesQuery.rows?.[0] || userMessagesQuery[0] || {}).user_messages || 0

    const botMessagesQuery = await db.knex.raw(
      'SELECT COUNT(*) as bot_messages FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ? AND direction = \'outgoing\'',
      [botId, startDate, endDate]
    )
    const botMessages = (botMessagesQuery.rows?.[0] || botMessagesQuery[0] || {}).bot_messages || 0

    // Obtener métricas de handoffs
    let totalHandoffs = 0
    let resolvedHandoffs = 0
    let avgDurationHandoffs = 0

    try {
      const handoffsQuery = await db.knex.raw(
        'SELECT COUNT(*) as total FROM hitl_sessions WHERE "botId" = ? AND DATE("createdAt") = DATE(?)',
        [botId, reportDate]
      )
      totalHandoffs = (handoffsQuery.rows?.[0] || handoffsQuery[0] || {}).total || 0

      const resolvedHandoffsQuery = await db.knex.raw(
        'SELECT COUNT(*) as resolved FROM hitl_sessions WHERE "botId" = ? AND DATE("createdAt") = DATE(?) AND status = \'resolved\'',
        [botId, reportDate]
      )
      resolvedHandoffs = (resolvedHandoffsQuery.rows?.[0] || resolvedHandoffsQuery[0] || {}).resolved || 0

      if (totalHandoffs > 0) {
        const avgDurationQuery = await db.knex.raw(
          'SELECT AVG(CAST((julianday("resolvedAt") - julianday("assignedAt")) * 24 * 60 AS REAL)) as avg_duration FROM hitl_sessions WHERE "botId" = ? AND DATE("createdAt") = DATE(?) AND "resolvedAt" IS NOT NULL AND "assignedAt" IS NOT NULL',
          [botId, reportDate]
        )
        avgDurationHandoffs =
          Math.round((avgDurationQuery.rows?.[0] || avgDurationQuery[0] || {}).avg_duration * 100) / 100 || 0
      }
    } catch (err) {
      // Si no existe la tabla hitl_sessions, usar valores por defecto
      bp.logger.warn('Tabla hitl_sessions no encontrada, usando valores por defecto')
    }

    // Generar resumen general con formato exacto del script
    reports.push({
      name: '00_resumen_general.txt',
      content: `========================================
RESUMEN GENERAL - ${botId}
Fecha: ${reportDate}
Generado: ${moment().format('ddd DD MMM YYYY HH:mm:ss')} CST
========================================

 Total de handoffs: ${totalHandoffs}
 Handoffs resueltos: ${resolvedHandoffs} de ${totalHandoffs}
 Duración promedio handoffs: ${avgDurationHandoffs} minutos
 Total de eventos: ${totalEvents}
 Conversaciones únicas: ${uniqueConversations}
 Mensajes del bot: ${botMessages}
 Mensajes de usuarios: ${userMessages}
 Usuarios únicos: ${uniqueUsers}


========================================
`
    })

    // 2. Mensajes detallados con todos los campos del script
    const detailedMessages = await db.knex.raw(
      "SELECT COALESCE(id, 'unknown') as event_id, COALESCE(\"botId\", 'unknown') as bot_id, COALESCE(channel, 'unknown') as channel, COALESCE(\"threadId\", 'unknown') as conversation_id, COALESCE(target, 'anonymous') as user_id, COALESCE(type, 'unknown') as message_type, COALESCE(direction, 'unknown') as direction, CASE WHEN direction = 'incoming' THEN 'Usuario' WHEN direction = 'outgoing' THEN 'Bot' ELSE 'Desconocido' END as sender, COALESCE(json_extract(event, '$.payload.text'), '') as message_text, COALESCE(json_extract(event, '$.payload.type'), '') as payload_type, CASE WHEN json_extract(event, '$.payload.quick_replies') IS NOT NULL THEN 'Sí' ELSE 'No' END as has_quick_replies, \"createdOn\" as timestamp, CAST(strftime('%H', \"createdOn\") AS INTEGER) as hour_of_day, CAST(strftime('%w', \"createdOn\") AS INTEGER) as day_of_week, COALESCE(json_extract(event, '$.payload.quick_replies'), '[]') as quick_replies_options FROM events WHERE \"botId\" = ? AND \"createdOn\" >= ? AND \"createdOn\" <= ? ORDER BY \"createdOn\" ASC",
      [botId, startDate, endDate]
    )

    reports.push({
      name: '01_mensajes_detallados.csv',
      content: convertToCSV(detailedMessages.rows || detailedMessages, [
        'event_id',
        'bot_id',
        'channel',
        'conversation_id',
        'user_id',
        'message_type',
        'direction',
        'sender',
        'message_text',
        'payload_type',
        'has_quick_replies',
        'timestamp',
        'hour_of_day',
        'day_of_week',
        'quick_replies_options'
      ])
    })

    // 3. Resumen de conversaciones con todos los campos del script
    const conversationsSummary = await db.knex.raw(
      'SELECT COALESCE("threadId", \'unknown\') as conversation_id, COALESCE(target, \'anonymous\') as user_id, COALESCE(channel, \'unknown\') as channel, MIN("createdOn") as conversation_start, MAX("createdOn") as conversation_end, COUNT(*) as total_messages, COUNT(CASE WHEN direction = \'incoming\' THEN 1 END) as user_messages, COUNT(CASE WHEN direction = \'outgoing\' THEN 1 END) as bot_messages, COALESCE(ROUND(CAST((julianday(MAX("createdOn")) - julianday(MIN("createdOn"))) * 24 * 60 AS REAL), 2), 0) as duration_minutes, GROUP_CONCAT(DISTINCT type) as message_types_used FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ? AND "threadId" IS NOT NULL GROUP BY "threadId", target, channel ORDER BY conversation_start ASC',
      [botId, startDate, endDate]
    )

    reports.push({
      name: '02_resumen_conversaciones.csv',
      content: convertToCSV(conversationsSummary.rows || conversationsSummary, [
        'conversation_id',
        'user_id',
        'channel',
        'conversation_start',
        'conversation_end',
        'total_messages',
        'user_messages',
        'bot_messages',
        'duration_minutes',
        'message_types_used'
      ])
    })

    // 4. Estadísticas por hora con campos adicionales
    const hourlyStats = await db.knex.raw(
      "SELECT CAST(strftime('%H', \"createdOn\") AS INTEGER) as hour_of_day, COUNT(*) as total_events, COUNT(CASE WHEN direction = 'incoming' THEN 1 END) as incoming_messages, COUNT(CASE WHEN direction = 'outgoing' THEN 1 END) as outgoing_messages, COUNT(DISTINCT COALESCE(\"threadId\", 'unknown_' || id)) as unique_conversations, COUNT(DISTINCT COALESCE(target, 'anonymous')) as unique_users, COUNT(CASE WHEN type = 'text' THEN 1 END) as text_messages, COUNT(CASE WHEN type = 'quick_reply' THEN 1 END) as quick_reply_messages, COUNT(CASE WHEN type = 'postback' THEN 1 END) as postback_messages FROM events WHERE \"botId\" = ? AND \"createdOn\" >= ? AND \"createdOn\" <= ? GROUP BY strftime('%H', \"createdOn\") ORDER BY hour_of_day ASC",
      [botId, startDate, endDate]
    )

    reports.push({
      name: '03_estadisticas_por_hora.csv',
      content: convertToCSV(hourlyStats.rows || hourlyStats, [
        'hour_of_day',
        'total_events',
        'incoming_messages',
        'outgoing_messages',
        'unique_conversations',
        'unique_users',
        'text_messages',
        'quick_reply_messages',
        'postback_messages'
      ])
    })

    // 5. Tipos de mensaje con estadísticas completas
    const messageTypes = await db.knex.raw(
      'SELECT COALESCE(type, \'unknown\') as message_type, COALESCE(direction, \'unknown\') as direction, COUNT(*) as message_count, COALESCE(ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ?)), 2), 0) as percentage, COUNT(DISTINCT COALESCE("threadId", \'unknown_\' || id)) as conversations_with_this_type, COUNT(DISTINCT COALESCE(target, \'anonymous\')) as users_with_this_type, MIN("createdOn") as first_occurrence, MAX("createdOn") as last_occurrence FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ? GROUP BY type, direction ORDER BY message_count DESC',
      [botId, startDate, endDate, botId, startDate, endDate]
    )

    reports.push({
      name: '04_tipos_de_mensaje.csv',
      content: convertToCSV(messageTypes.rows || messageTypes, [
        'message_type',
        'direction',
        'message_count',
        'percentage',
        'conversations_with_this_type',
        'users_with_this_type',
        'first_occurrence',
        'last_occurrence'
      ])
    })

    // 6. Usuarios activos con campos completos
    const activeUsers = await db.knex.raw(
      'SELECT COALESCE(target, \'anonymous\') as user_id, COALESCE(channel, \'unknown\') as channel, COUNT(*) as total_messages, COUNT(CASE WHEN direction = \'incoming\' THEN 1 END) as messages_sent, COUNT(CASE WHEN direction = \'outgoing\' THEN 1 END) as messages_received, COUNT(DISTINCT COALESCE("threadId", \'unknown_\' || id)) as conversations_participated, MIN("createdOn") as first_message_time, MAX("createdOn") as last_message_time, COALESCE(ROUND(CAST((julianday(MAX("createdOn")) - julianday(MIN("createdOn"))) * 24 * 60 AS REAL), 2), 0) as activity_duration_minutes FROM events WHERE "botId" = ? AND "createdOn" >= ? AND "createdOn" <= ? AND target IS NOT NULL GROUP BY target, channel ORDER BY total_messages DESC',
      [botId, startDate, endDate]
    )

    reports.push({
      name: '05_usuarios_activos.csv',
      content: convertToCSV(activeUsers.rows || activeUsers, [
        'user_id',
        'channel',
        'total_messages',
        'messages_sent',
        'messages_received',
        'conversations_participated',
        'first_message_time',
        'last_message_time',
        'activity_duration_minutes'
      ])
    })

    // 7. Handoffs detallados
    try {
      const handoffs = await db.knex.raw(
        'SELECT COALESCE(id, \'unknown\') as handoff_id, COALESCE("userId", \'anonymous\') as user_id, \'unknown@email.com\' as agent_email, \'unknown\' as agent_workspace, COALESCE("userThreadId", \'unknown\') as conversation_id, COALESCE("userChannel", \'unknown\') as channel, COALESCE(status, \'unknown\') as status, "createdAt" as created_at, "assignedAt" as assigned_at, "resolvedAt" as resolved_at, CASE WHEN "resolvedAt" IS NOT NULL AND "createdAt" IS NOT NULL THEN COALESCE(ROUND(CAST((julianday("resolvedAt") - julianday("createdAt")) * 24 * 60 AS REAL), 2), 0) ELSE NULL END as duration_minutes, COALESCE(CAST(strftime(\'%H\', "createdAt") AS INTEGER), 0) as hour_created, CASE WHEN "assignedAt" IS NOT NULL AND "createdAt" IS NOT NULL THEN COALESCE(ROUND(CAST((julianday("assignedAt") - julianday("createdAt")) * 24 * 60 * 60 AS REAL), 2), 0) ELSE NULL END as assignment_delay_seconds FROM hitl_sessions WHERE "botId" = ? AND DATE("createdAt") = DATE(?) ORDER BY "createdAt" ASC',
        [botId, reportDate]
      )

      reports.push({
        name: '06_handoffs_detallados.csv',
        content: convertToCSV(handoffs.rows || handoffs, [
          'handoff_id',
          'user_id',
          'agent_email',
          'agent_workspace',
          'conversation_id',
          'channel',
          'status',
          'created_at',
          'assigned_at',
          'resolved_at',
          'duration_minutes',
          'hour_created',
          'assignment_delay_seconds'
        ])
      })
    } catch (err) {
      // Si no existe la tabla, crear un archivo vacío
      reports.push({
        name: '06_handoffs_detallados.csv',
        content:
          'handoff_id,user_id,agent_email,agent_workspace,conversation_id,channel,status,created_at,assigned_at,resolved_at,duration_minutes,hour_created,assignment_delay_seconds\n'
      })
    }

    // 8. Análisis completo en markdown
    const topUserData = (activeUsers.rows || activeUsers)[0] || {}
    const topUserId = topUserData.user_id ? topUserData.user_id.substring(0, 8) : 'N/A'
    const topUserMessages = topUserData.total_messages || 0

    const handoffPercentage =
      uniqueConversations > 0 && totalHandoffs > 0
        ? Math.round((totalHandoffs / uniqueConversations) * 100 * 100) / 100
        : 0

    const avgMessagesPerUser = uniqueUsers > 0 ? Math.round((totalEvents / uniqueUsers) * 100) / 100 : 0

    const avgMessagesPerConversation =
      uniqueConversations > 0 ? Math.round((totalEvents / uniqueConversations) * 100) / 100 : 0

    const getVolumeType = () => {
      if (totalEvents > 1000) {
        return 'Volumen Alto'
      }
      if (totalEvents > 500) {
        return 'Volumen Medio'
      }
      return 'Volumen Bajo'
    }

    const getActivityDescription = () => {
      if (totalEvents > 1000) {
        return 'mucha'
      }
      if (totalEvents > 500) {
        return 'actividad moderada'
      }
      return 'poca'
    }

    const getUserProfile = () => {
      if (topUserMessages > 200) {
        return 'Super usuario con engagement excepcional'
      }
      if (topUserMessages > 50) {
        return 'Usuario muy activo'
      }
      return 'Usuario moderadamente activo'
    }

    const getHandoffEvaluation = () => {
      if (handoffPercentage > 20) {
        return 'Tasa alta - revisar automatización'
      }
      if (handoffPercentage > 10) {
        return 'Tasa moderada - normal'
      }
      return 'Tasa baja - bot maneja bien las consultas'
    }

    const getConclusionActivity = () => {
      if (totalEvents > 1000) {
        return `Día de **alta actividad** con ${totalEvents} eventos procesados. El bot demostró capacidad para manejar volumen significativo con ${uniqueUsers} usuarios únicos y ${uniqueConversations} conversaciones.`
      }
      return `Día de **actividad moderada** con ${totalEvents} eventos. Rendimiento estable con ${uniqueUsers} usuarios y ${uniqueConversations} conversaciones.`
    }

    const getConclusionHandoffs = () => {
      if (totalHandoffs > 0) {
        return `La tasa de handoffs del ${handoffPercentage}% indica un balance adecuado entre automatización y asistencia humana.`
      }
      return 'La ausencia de handoffs demuestra excelente automatización del bot.'
    }

    const getOptimizationRecommendation = () => {
      if (totalHandoffs > 0) {
        return `Revisar los ${totalHandoffs} casos para identificar patrones de automatización`
      }
      return 'Mantener el excelente nivel de automatización'
    }

    const analysisContent = `# Análisis Completo - Bot ${botId}
**Fecha:** ${reportDate}  
**Período:** 00:00:00 - 23:59:59 UTC  
**Generado:** ${moment().format('DD [de] MMMM [de] YYYY, HH:mm UTC')}

---

## 📊 Resumen Ejecutivo

### Métricas Generales del Día
- **Total de Eventos:** ${totalEvents}
- **Usuarios Únicos:** ${uniqueUsers}
- **Conversaciones Totales:** ${uniqueConversations}
- **Handoffs Realizados:** ${totalHandoffs}
- **Canales Activos:** 2 (web, vonage)

### Rendimiento General
- **Promedio de Mensajes por Usuario:** ${avgMessagesPerUser}
- **Promedio de Mensajes por Conversación:** ${avgMessagesPerConversation}
- **Tasa de Handoffs:** ${handoffPercentage}% (${totalHandoffs} de ${uniqueConversations} conversaciones)

---

## 💬 Análisis de Actividad de Mensajería

### Usuario Más Activo
- **Usuario ID:** ${topUserId}
- **Mensajes Totales:** ${topUserMessages}
- **Perfil:** ${getUserProfile()}

### Distribución de Actividad
- **${getVolumeType()}:** Día de ${getActivityDescription()} actividad con ${totalEvents} eventos

---

## 🤝 Análisis de Handoffs

### Estadísticas de Transferencias
- **Total de Handoffs:** ${totalHandoffs}
- **Porcentaje de Conversaciones:** ${handoffPercentage}%
- **Evaluación:** ${getHandoffEvaluation()}

---

## 📈 Insights y Recomendaciones

### Fortalezas Identificadas
1. **Engagement de Usuarios:** Promedio de ${avgMessagesPerUser} mensajes por usuario
2. **Volumen de Actividad:** ${totalEvents} eventos procesados exitosamente
3. **Diversidad de Usuarios:** ${uniqueUsers} usuarios únicos interactuaron

### Recomendaciones Estratégicas
1. **Optimización de Handoffs:** ${getOptimizationRecommendation()}
2. **Análisis de Usuarios:** Estudiar comportamiento del usuario más activo (${topUserMessages} mensajes) para replicar engagement
3. **Monitoreo Continuo:** Mantener seguimiento de métricas clave para identificar tendencias

---

## 📋 Archivos de Datos Generados

### Reportes Disponibles
- \`00_resumen_general.txt\` - Métricas básicas del día
- \`01_mensajes_detallados.csv\` - Todos los mensajes (${totalEvents} registros)
- \`02_resumen_conversaciones.csv\` - Resumen por conversación (${uniqueConversations} registros)
- \`03_estadisticas_por_hora.csv\` - Actividad por hora
- \`04_tipos_de_mensaje.csv\` - Distribución de tipos de mensaje
- \`05_usuarios_activos.csv\` - Ranking de usuarios más activos (${uniqueUsers} registros)
- \`06_handoffs_detallados.csv\` - Detalles de transferencias (${totalHandoffs} registros)

---

## 📋 Conclusiones

${getConclusionActivity()}

${getConclusionHandoffs()}

**Próximos Pasos Sugeridos:**
1. Continuar monitoreando métricas de engagement
2. Analizar patrones temporales en estadísticas por hora
3. Evaluar oportunidades de mejora en tipos de mensaje más frecuentes

---

*Análisis generado automáticamente el ${moment().format('ddd DD MMM YYYY HH:mm:ss')} CST*  
*Sistema de reportes Botpress v12 - Datos de producción AWS*
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
