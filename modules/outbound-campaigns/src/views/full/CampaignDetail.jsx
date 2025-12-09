import React, { useState, useEffect, useCallback } from 'react'
import {
  Button,
  Intent,
  Card,
  Elevation,
  Tag,
  ProgressBar,
  Callout,
  H4,
  H5,
  Spinner,
  Toaster,
  Position,
  HTMLTable,
  Icon,
  Divider,
  Tabs,
  Tab
} from '@blueprintjs/core'

import CSVUploader from './CSVUploader.jsx'

const toaster = Toaster.create({ position: Position.TOP })

// Intervalo de polling en milisegundos (5 segundos)
const POLLING_INTERVAL = 5000

/**
 * Componente CampaignDetail - Vista completa de una campaña con métricas y controles
 * 
 * CHECKPOINT 2.5: Detalle de Campaña
 * - Header: Nombre, estado actual, fecha de creación
 * - Métricas en cards: Total destinatarios, Enviados, Fallidos, Pendientes
 * - Barra de progreso visual
 * - Botones de acción: Iniciar | Pausar | Reanudar
 * - Botón exportar fallidos (descargar CSV)
 * - Timeline de eventos/logs
 * - Polling automático cuando status = running
 */
const CampaignDetail = ({ bp, campaign: initialCampaign, onBack, onEdit }) => {
  const [campaign, setCampaign] = useState(initialCampaign)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  const [logs, setLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [report, setReport] = useState(null)

  // Cargar datos de la campaña
  const loadCampaign = useCallback(async () => {
    try {
      const { data } = await bp.axios.get(`mod/outbound-campaigns/campaigns/${campaign.id}`)
      if (data.success) {
        setCampaign(data.campaign)
      }
    } catch (err) {
      console.error('Error loading campaign:', err)
    }
  }, [bp, campaign.id])

  // Cargar reporte con logs
  const loadReport = useCallback(async () => {
    try {
      setLogsLoading(true)
      const { data } = await bp.axios.get(`mod/outbound-campaigns/campaigns/${campaign.id}/report`)
      if (data.success) {
        setReport(data)
        setLogs(data.logs || [])
      }
    } catch (err) {
      console.error('Error loading report:', err)
    } finally {
      setLogsLoading(false)
    }
  }, [bp, campaign.id])

  // Cargar datos iniciales
  useEffect(() => {
    loadCampaign()
    loadReport()
  }, [])

  // Polling automático cuando la campaña está en ejecución
  useEffect(() => {
    if (campaign.status === 'running') {
      const interval = setInterval(() => {
        loadCampaign()
      }, POLLING_INTERVAL)

      return () => clearInterval(interval)
    }
  }, [campaign.status, loadCampaign])

  // Calcular métricas
  const totalRecipients = campaign.total_recipients || 0
  const sentCount = campaign.sent_count || 0
  const failedCount = campaign.failed_count || 0
  const pendingCount = Math.max(0, totalRecipients - sentCount - failedCount)
  const progress = totalRecipients > 0 ? (sentCount + failedCount) / totalRecipients : 0

  // Mapa de estados a colores e iconos
  const getStatusConfig = (status) => {
    const statusMap = {
      draft: { intent: Intent.NONE, text: 'Borrador', icon: 'document' },
      scheduled: { intent: Intent.PRIMARY, text: 'Programada', icon: 'time' },
      running: { intent: Intent.SUCCESS, text: 'En ejecución', icon: 'play' },
      paused: { intent: Intent.WARNING, text: 'Pausada', icon: 'pause' },
      completed: { intent: Intent.SUCCESS, text: 'Completada', icon: 'tick-circle' },
      failed: { intent: Intent.DANGER, text: 'Fallida', icon: 'error' }
    }
    return statusMap[status] || { intent: Intent.NONE, text: status, icon: 'help' }
  }

  const statusConfig = getStatusConfig(campaign.status)

  // Acciones de campaña
  const handleStart = async () => {
    try {
      setActionLoading('start')
      const { data } = await bp.axios.post(`mod/outbound-campaigns/campaigns/${campaign.id}/start`)

      if (data.success) {
        toaster.show({ message: 'Campaña iniciada correctamente', intent: Intent.SUCCESS })
        loadCampaign()
        loadReport()
      } else {
        toaster.show({ message: data.error || 'Error al iniciar la campaña', intent: Intent.DANGER })
      }
    } catch (err) {
      console.error('Error starting campaign:', err)
      toaster.show({ message: 'Error al iniciar la campaña', intent: Intent.DANGER })
    } finally {
      setActionLoading(null)
    }
  }

  const handlePause = async () => {
    try {
      setActionLoading('pause')
      const { data } = await bp.axios.post(`mod/outbound-campaigns/campaigns/${campaign.id}/pause`)

      if (data.success) {
        toaster.show({ message: 'Campaña pausada correctamente', intent: Intent.SUCCESS })
        loadCampaign()
        loadReport()
      } else {
        toaster.show({ message: data.error || 'Error al pausar la campaña', intent: Intent.DANGER })
      }
    } catch (err) {
      console.error('Error pausing campaign:', err)
      toaster.show({ message: 'Error al pausar la campaña', intent: Intent.DANGER })
    } finally {
      setActionLoading(null)
    }
  }

  const handleResume = async () => {
    try {
      setActionLoading('resume')
      const { data } = await bp.axios.post(`mod/outbound-campaigns/campaigns/${campaign.id}/resume`)

      if (data.success) {
        toaster.show({ message: 'Campaña reanudada correctamente', intent: Intent.SUCCESS })
        loadCampaign()
        loadReport()
      } else {
        toaster.show({ message: data.error || 'Error al reanudar la campaña', intent: Intent.DANGER })
      }
    } catch (err) {
      console.error('Error resuming campaign:', err)
      toaster.show({ message: 'Error al reanudar la campaña', intent: Intent.DANGER })
    } finally {
      setActionLoading(null)
    }
  }

  // Exportar fallidos a CSV
  const handleExportFailed = async () => {
    try {
      setActionLoading('export')
      
      const response = await bp.axios.get(
        `mod/outbound-campaigns/campaigns/${campaign.id}/export-failed`,
        { responseType: 'blob' }
      )

      // Crear link de descarga
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `failed-recipients-${campaign.id}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      toaster.show({ message: 'Archivo descargado correctamente', intent: Intent.SUCCESS })
    } catch (err) {
      console.error('Error exporting failed:', err)
      toaster.show({ message: 'Error al exportar los fallidos', intent: Intent.DANGER })
    } finally {
      setActionLoading(null)
    }
  }

  // Callback cuando se sube CSV exitosamente
  const handleUploadSuccess = () => {
    loadCampaign()
    loadReport()
    toaster.show({ message: 'Destinatarios importados correctamente', intent: Intent.SUCCESS })
  }

  // Formatear fecha
  const formatDate = (dateString) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Formatear tipo de evento de log
  const getLogIcon = (eventType) => {
    const iconMap = {
      created: 'add',
      started: 'play',
      paused: 'pause',
      resumed: 'play',
      completed: 'tick-circle',
      message_sent: 'tick',
      message_failed: 'error',
      recipients_imported: 'import',
      batch_processed: 'layers'
    }
    return iconMap[eventType] || 'info-sign'
  }

  const getLogIntent = (eventType) => {
    const intentMap = {
      created: Intent.NONE,
      started: Intent.SUCCESS,
      paused: Intent.WARNING,
      resumed: Intent.SUCCESS,
      completed: Intent.SUCCESS,
      message_sent: Intent.SUCCESS,
      message_failed: Intent.DANGER,
      recipients_imported: Intent.PRIMARY,
      batch_processed: Intent.PRIMARY
    }
    return intentMap[eventType] || Intent.NONE
  }

  return (
    <div className="campaign-detail">
      {/* Header */}
      <div className="campaign-detail__header">
        <div>
          <H4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Button icon="arrow-left" minimal onClick={onBack} />
            {campaign.name}
            <Tag 
              intent={statusConfig.intent} 
              icon={statusConfig.icon}
              className={`campaign-status campaign-status--${campaign.status}`}
            >
              {statusConfig.text}
            </Tag>
            {campaign.status === 'running' && (
              <Spinner size={16} />
            )}
          </H4>
          <p style={{ margin: '5px 0 0 40px', color: '#5c7080', fontSize: '13px' }}>
            <strong>Template:</strong> {campaign.template_id} &nbsp;|&nbsp;
            <strong>Creada:</strong> {formatDate(campaign.created_at)}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {campaign.status === 'draft' && (
            <>
              <Button
                icon="edit"
                text="Editar"
                onClick={onEdit}
              />
              <Button
                intent={Intent.SUCCESS}
                icon={actionLoading === 'start' ? <Spinner size={16} /> : 'play'}
                text="Iniciar campaña"
                onClick={handleStart}
                disabled={actionLoading || totalRecipients === 0}
              />
            </>
          )}

          {campaign.status === 'running' && (
            <Button
              intent={Intent.WARNING}
              icon={actionLoading === 'pause' ? <Spinner size={16} /> : 'pause'}
              text="Pausar"
              onClick={handlePause}
              disabled={actionLoading}
            />
          )}

          {campaign.status === 'paused' && (
            <Button
              intent={Intent.SUCCESS}
              icon={actionLoading === 'resume' ? <Spinner size={16} /> : 'play'}
              text="Reanudar"
              onClick={handleResume}
              disabled={actionLoading}
            />
          )}

          {failedCount > 0 && (
            <Button
              icon={actionLoading === 'export' ? <Spinner size={16} /> : 'export'}
              text="Exportar fallidos"
              onClick={handleExportFailed}
              disabled={actionLoading}
            />
          )}
        </div>
      </div>

      {/* Métricas */}
      <div className="campaign-detail__metrics">
        <Card elevation={Elevation.ONE} className="campaign-detail__metric-card">
          <H4 style={{ color: '#5c7080' }}>{totalRecipients}</H4>
          <p>Total destinatarios</p>
        </Card>
        <Card elevation={Elevation.ONE} className="campaign-detail__metric-card">
          <H4 style={{ color: '#0f9960' }}>{sentCount}</H4>
          <p>Enviados ✓</p>
        </Card>
        <Card elevation={Elevation.ONE} className="campaign-detail__metric-card">
          <H4 style={{ color: '#db3737' }}>{failedCount}</H4>
          <p>Fallidos ✗</p>
        </Card>
        <Card elevation={Elevation.ONE} className="campaign-detail__metric-card">
          <H4 style={{ color: '#8a8a8a' }}>{pendingCount}</H4>
          <p>Pendientes</p>
        </Card>
      </div>

      {/* Barra de progreso */}
      {totalRecipients > 0 && (
        <Card elevation={Elevation.ONE} style={{ marginBottom: '20px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span>Progreso de envío</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <ProgressBar
            value={progress}
            intent={failedCount > 0 ? Intent.WARNING : Intent.SUCCESS}
            stripes={campaign.status === 'running'}
            animate={campaign.status === 'running'}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '12px', color: '#8a8a8a' }}>
            <span>Tamaño de lote: {campaign.batch_size}</span>
            <span>Intervalo: {Math.round(campaign.batch_interval_ms / 1000)}s</span>
          </div>
        </Card>
      )}

      {/* Tabs: Overview / Subir CSV / Logs */}
      <div style={{ 
        maxHeight: '600px', 
        overflowY: 'auto', 
        overflowX: 'hidden',
        scrollbarWidth: 'none', // Firefox
        msOverflowStyle: 'none' // IE/Edge
      }} className="campaign-tabs-container">
        <style>{`
          .campaign-tabs-container::-webkit-scrollbar {
            display: none; /* Chrome, Safari, Opera */
          }
        `}</style>
        <Tabs
          id="campaign-tabs"
          selectedTabId={activeTab}
          onChange={(tabId) => setActiveTab(tabId)}
        >
        <Tab
          id="overview"
          title="Resumen"
          panel={
            <Card elevation={Elevation.ONE} style={{ marginTop: '15px' }}>
              {/* Información de configuración */}
              <H5>Configuración de la campaña</H5>
              <HTMLTable striped style={{ width: '100%' }}>
                <tbody>
                  <tr>
                    <td><strong>Nombre</strong></td>
                    <td>{campaign.name}</td>
                  </tr>
                  <tr>
                    <td><strong>Template ID</strong></td>
                    <td><code>{campaign.template_id}</code></td>
                  </tr>
                  <tr>
                    <td><strong>Estado</strong></td>
                    <td>
                      <Tag intent={statusConfig.intent} icon={statusConfig.icon}>
                        {statusConfig.text}
                      </Tag>
                    </td>
                  </tr>
                  <tr>
                    <td><strong>Tamaño de lote</strong></td>
                    <td>{campaign.batch_size} mensajes</td>
                  </tr>
                  <tr>
                    <td><strong>Intervalo entre lotes</strong></td>
                    <td>{Math.round(campaign.batch_interval_ms / 1000)} segundos</td>
                  </tr>
                  <tr>
                    <td><strong>Fecha de creación</strong></td>
                    <td>{formatDate(campaign.created_at)}</td>
                  </tr>
                  {campaign.started_at && (
                    <tr>
                      <td><strong>Fecha de inicio</strong></td>
                      <td>{formatDate(campaign.started_at)}</td>
                    </tr>
                  )}
                  {campaign.completed_at && (
                    <tr>
                      <td><strong>Fecha de finalización</strong></td>
                      <td>{formatDate(campaign.completed_at)}</td>
                    </tr>
                  )}
                </tbody>
              </HTMLTable>

              {/* Alerta si no hay destinatarios */}
              {totalRecipients === 0 && campaign.status === 'draft' && (
                <Callout intent={Intent.PRIMARY} icon="info-sign" style={{ marginTop: '20px' }}>
                  Esta campaña aún no tiene destinatarios. Ve a la pestaña "Subir CSV" para importar los números de teléfono.
                </Callout>
              )}
            </Card>
          }
        />

        <Tab
          id="upload"
          title="Subir CSV"
          disabled={campaign.status !== 'draft'}
          panel={
            <Card elevation={Elevation.ONE} style={{ marginTop: '15px' }}>
              {campaign.status === 'draft' ? (
                <>
                  <H5>Importar destinatarios</H5>
                  <p style={{ color: '#5c7080', marginBottom: '20px' }}>
                    Sube un archivo CSV con los números de teléfono de los destinatarios.
                    El archivo debe tener una columna <code>phone_number</code> con los números en formato E.164 (ej: +521234567890).
                  </p>
                  <CSVUploader
                    bp={bp}
                    campaignId={campaign.id}
                    onUploadSuccess={handleUploadSuccess}
                  />
                </>
              ) : (
                <Callout intent={Intent.WARNING} icon="warning-sign">
                  No se pueden modificar los destinatarios una vez que la campaña ha sido iniciada.
                </Callout>
              )}
            </Card>
          }
        />

        <Tab
          id="logs"
          title={`Actividad (${logs.length})`}
          panel={
            <Card elevation={Elevation.ONE} style={{ marginTop: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <H5 style={{ margin: 0 }}>Historial de actividad</H5>
                <Button
                  icon="refresh"
                  minimal
                  onClick={loadReport}
                  loading={logsLoading}
                />
              </div>

              {logs.length === 0 ? (
                <p style={{ color: '#8a8a8a', textAlign: 'center', padding: '20px' }}>
                  No hay actividad registrada aún
                </p>
              ) : (
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {logs.map((log, index) => (
                    <div
                      key={log.id || index}
                      style={{
                        display: 'flex',
                        gap: '15px',
                        padding: '10px 0',
                        borderBottom: index < logs.length - 1 ? '1px solid #ced9e0' : 'none'
                      }}
                    >
                      <Icon
                        icon={getLogIcon(log.event_type)}
                        intent={getLogIntent(log.event_type)}
                        size={16}
                        style={{ marginTop: '2px' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong>{log.event_type.replace(/_/g, ' ')}</strong>
                          <span style={{ color: '#8a8a8a', fontSize: '12px' }}>
                            {formatDate(log.created_at)}
                          </span>
                        </div>
                        {log.event_data && (
                          <p style={{ margin: '5px 0 0 0', color: '#5c7080', fontSize: '13px' }}>
                            {typeof log.event_data === 'string'
                              ? log.event_data
                              : JSON.stringify(log.event_data)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          }
        />
      </Tabs>
      </div>
    </div>
  )
}

export default CampaignDetail
