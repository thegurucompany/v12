import { Spinner } from '@blueprintjs/core'
import { lang } from 'botpress/shared'
import React, { FC, useEffect, useState } from 'react'

import { HitlClient, IConversationStats } from '../../../client'
import style from './ConversationStats.scss'

interface Props {
  api: HitlClient
}

const ConversationStats: FC<Props> = ({ api }) => {
  const [stats, setStats] = useState<IConversationStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadStats = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.getConversationStats()
      setStats(data)
    } catch (err) {
      setError(err.message || 'Error al cargar estadísticas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Cargar estadísticas al montar el componente
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    loadStats()

    // Actualizar cada 30 segundos
    const interval = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      loadStats()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  if (loading && !stats) {
    return (
      <div className={style.statsContainer}>
        <Spinner size={20} />
      </div>
    )
  }

  if (error) {
    return (
      <div className={style.statsContainer}>
        <div className={style.error}>{error}</div>
      </div>
    )
  }

  if (!stats) {
    return null
  }

  return (
    <div className={style.statsContainer}>
      <div className={style.statsGrid}>
        <div className={style.statCard}>
          <div className={style.statValue}>{stats.totalActive}</div>
          <div className={style.statLabel}>{lang.tr('module.hitlnext.stats.totalActive')}</div>
        </div>

        <div className={style.statCard}>
          <div className={style.statValue}>{stats.unresolved}</div>
          <div className={style.statLabel}>{lang.tr('module.hitlnext.stats.unresolved')}</div>
        </div>

        <div className={style.statCard}>
          <div className={style.statValue}>{stats.pending}</div>
          <div className={style.statLabel}>{lang.tr('module.hitlnext.stats.pending')}</div>
        </div>

        <div className={style.statCard}>
          <div className={style.statValue}>{stats.unassigned}</div>
          <div className={style.statLabel}>{lang.tr('module.hitlnext.stats.unassigned')}</div>
        </div>

        <div className={style.statCard}>
          <div className={style.statValue}>{stats.resolvedToday}</div>
          <div className={style.statLabel}>{lang.tr('module.hitlnext.stats.resolvedToday')}</div>
        </div>

        <div className={style.statCard}>
          <div className={style.statValue}>{stats.onHold}</div>
          <div className={style.statLabel}>{lang.tr('module.hitlnext.stats.onHold')}</div>
        </div>
      </div>
    </div>
  )
}

export default ConversationStats
