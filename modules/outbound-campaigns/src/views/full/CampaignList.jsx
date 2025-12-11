import React, { useState, useEffect, useCallback } from 'react'
import {
  Button,
  Intent,
  Card,
  Elevation,
  HTMLTable,
  Tag,
  ProgressBar,
  NonIdealState,
  ButtonGroup,
  Spinner,
  Alert,
  Toaster,
  Position
} from '@blueprintjs/core'
import ExportModal from './ExportModal'

const toaster = Toaster.create({ position: Position.TOP })

// Intervalo de polling en milisegundos (5 segundos)
const POLLING_INTERVAL = 5000

/**
 * Componente CampaignList - Lista de campañas con filtros y acciones
 * 
 * CHECKPOINT 2.2: Lista de Campañas
 * - Tabla con columnas: Nombre, Estado, Progreso, Enviados/Fallidos, Acciones
 * - Filtros: Todas | Activas | Completadas | Fallidas
 * - Botón "+ Nueva Campaña" que abre formulario
 * - Acciones en cada fila: Ver detalle, Iniciar/Pausar, Eliminar
 * - Actualización automática cada 5 segundos cuando hay campañas running
 */
const CampaignList = ({ bp, campaigns, onRefresh, onCreateNew, onViewDetail }) => {
  const [filter, setFilter] = useState('all')
  const [isPolling, setIsPolling] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)

  // Polling automático cuando hay campañas en ejecución
  useEffect(() => {
    const hasRunningCampaigns = campaigns.some(c => c.status === 'running')
    
    if (hasRunningCampaigns) {
      setIsPolling(true)
      const interval = setInterval(() => {
        onRefresh()
      }, POLLING_INTERVAL)
      
      return () => {
        clearInterval(interval)
        setIsPolling(false)
      }
    } else {
      setIsPolling(false)
    }
  }, [campaigns, onRefresh])

  // Filtrar campañas según el filtro seleccionado
  const filteredCampaigns = campaigns.filter(campaign => {
    switch (filter) {
      case 'active':
        return ['running', 'paused', 'scheduled'].includes(campaign.status)
      case 'completed':
        return campaign.status === 'completed'
      case 'failed':
        return campaign.status === 'failed'
      case 'draft':
        return campaign.status === 'draft'
      default:
        return true
    }
  })

  // Mapa de estados a Tags con colores
  const getStatusTag = (status) => {
    const statusMap = {
      draft: { intent: Intent.NONE, text: 'Borrador', icon: 'document' },
      scheduled: { intent: Intent.PRIMARY, text: 'Programada', icon: 'time' },
      running: { intent: Intent.SUCCESS, text: 'En ejecución', icon: 'play' },
      paused: { intent: Intent.WARNING, text: 'Pausada', icon: 'pause' },
      completed: { intent: Intent.SUCCESS, text: 'Completada', icon: 'tick-circle' },
      failed: { intent: Intent.DANGER, text: 'Fallida', icon: 'error' }
    }
    const config = statusMap[status] || { intent: Intent.NONE, text: status, icon: 'help' }
    return (
      <Tag 
        intent={config.intent} 
        icon={config.icon}
        className={`campaign-status campaign-status--${status}`}
      >
        {config.text}
      </Tag>
    )
  }

  // Acciones de campaña
  const handleStart = async (campaignId) => {
    try {
      setActionLoading(campaignId)
      const { data } = await bp.axios.post(`mod/outbound-campaigns/campaigns/${campaignId}/start`)
      
      if (data.success) {
        toaster.show({ message: 'Campaña iniciada correctamente', intent: Intent.SUCCESS })
        onRefresh()
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

  const handlePause = async (campaignId) => {
    try {
      setActionLoading(campaignId)
      const { data } = await bp.axios.post(`mod/outbound-campaigns/campaigns/${campaignId}/pause`)
      
      if (data.success) {
        toaster.show({ message: 'Campaña pausada correctamente', intent: Intent.SUCCESS })
        onRefresh()
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

  const handleResume = async (campaignId) => {
    try {
      setActionLoading(campaignId)
      const { data } = await bp.axios.post(`mod/outbound-campaigns/campaigns/${campaignId}/resume`)
      
      if (data.success) {
        toaster.show({ message: 'Campaña reanudada correctamente', intent: Intent.SUCCESS })
        onRefresh()
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

  const handleDelete = async (campaignId) => {
    try {
      setActionLoading(campaignId)
      const { data } = await bp.axios.delete(`mod/outbound-campaigns/campaigns/${campaignId}`)
      
      if (data.success) {
        toaster.show({ message: 'Campaña eliminada correctamente', intent: Intent.SUCCESS })
        onRefresh()
      } else {
        toaster.show({ message: data.error || 'Error al eliminar la campaña', intent: Intent.DANGER })
      }
    } catch (err) {
      console.error('Error deleting campaign:', err)
      toaster.show({ message: 'Error al eliminar la campaña', intent: Intent.DANGER })
    } finally {
      setActionLoading(null)
      setDeleteConfirm(null)
    }
  }

  // Calcular contadores para los filtros
  const getCounts = () => {
    const counts = {
      all: campaigns.length,
      active: campaigns.filter(c => ['running', 'paused', 'scheduled'].includes(c.status)).length,
      completed: campaigns.filter(c => c.status === 'completed').length,
      failed: campaigns.filter(c => c.status === 'failed').length,
      draft: campaigns.filter(c => c.status === 'draft').length
    }
    return counts
  }

  const counts = getCounts()

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

  return (
    <div className="campaign-list">
      {/* Header con filtros y botón de crear */}
      <div className="campaign-list__header">
        <div className="campaign-list__filters">
          <ButtonGroup>
            <Button 
              active={filter === 'all'} 
              onClick={() => setFilter('all')}
            >
              Todas ({counts.all})
            </Button>
            <Button 
              active={filter === 'active'} 
              onClick={() => setFilter('active')}
              icon="play"
            >
              Activas ({counts.active})
            </Button>
            <Button 
              active={filter === 'completed'} 
            onClick={() => setFilter('completed')}
            icon="tick-circle"
          >
            Completadas ({counts.completed})
          </Button>
          <Button 
            active={filter === 'failed'} 
            onClick={() => setFilter('failed')}
            icon="error"
          >
            Fallidas ({counts.failed})
          </Button>
          <Button 
            active={filter === 'draft'} 
            onClick={() => setFilter('draft')}
            icon="document"
          >
            Borradores ({counts.draft})
          </Button>
          </ButtonGroup>
        </div>

        <div className="campaign-list__actions">
          {isPolling && (
            <Tag intent={Intent.PRIMARY} icon="refresh" minimal>
              Actualizando...
            </Tag>
          )}
          <Button 
            icon="refresh" 
            minimal 
            onClick={onRefresh}
            title="Actualizar lista"
          />
          <Button 
            icon="download" 
            intent={Intent.SUCCESS}
            text="Exportar Historial"
            onClick={() => setExportModalOpen(true)}
            title="Descargar historial de envíos masivos (CSV + MD)"
          />
          <Button 
            intent={Intent.PRIMARY} 
            icon="plus"
            text="Nueva Campaña"
            onClick={onCreateNew}
          />
        </div>
      </div>

      {/* Contenido */}
      {filteredCampaigns.length === 0 ? (
        <NonIdealState
          icon="inbox"
          title={filter === 'all' ? 'Sin campañas' : `Sin campañas ${filter === 'active' ? 'activas' : filter === 'completed' ? 'completadas' : filter === 'failed' ? 'fallidas' : 'en borrador'}`}
          description={filter === 'all' 
            ? 'No hay campañas creadas. Crea una nueva campaña para empezar a enviar mensajes.'
            : 'No hay campañas que coincidan con el filtro seleccionado.'
          }
        />
      ) : (
        <Card elevation={Elevation.ONE} className="campaign-list__card">
          <HTMLTable striped interactive className="campaigns-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Estado</th>
                <th>Progreso</th>
                <th>Enviados</th>
                <th>Fallidos</th>
                <th>Creada</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map(campaign => {
                const progress = campaign.total_recipients > 0 
                  ? (campaign.sent_count + campaign.failed_count) / campaign.total_recipients 
                  : 0
                const isLoading = actionLoading === campaign.id

                return (
                  <tr key={campaign.id}>
                    <td>
                      <strong>{campaign.name}</strong>
                      <br />
                      <small className="bp3-text-muted">
                        {campaign.total_recipients} destinatarios
                      </small>
                    </td>
                    <td>{getStatusTag(campaign.status)}</td>
                    <td style={{ width: '150px' }}>
                      <ProgressBar 
                        value={progress} 
                        intent={campaign.status === 'running' ? Intent.PRIMARY : Intent.NONE}
                        stripes={campaign.status === 'running'}
                        animate={campaign.status === 'running'}
                      />
                      <small className="bp3-text-muted">
                        {Math.round(progress * 100)}%
                      </small>
                    </td>
                    <td>
                      <Tag intent={Intent.SUCCESS} minimal>{campaign.sent_count}</Tag>
                    </td>
                    <td>
                      <Tag intent={campaign.failed_count > 0 ? Intent.DANGER : Intent.NONE} minimal>
                        {campaign.failed_count}
                      </Tag>
                    </td>
                    <td>
                      <small>{formatDate(campaign.created_at)}</small>
                    </td>
                    <td>
                      {isLoading ? (
                        <Spinner size={20} />
                      ) : (
                        <>
                          <Button 
                            small 
                            minimal 
                            icon="eye-open" 
                            title="Ver detalle"
                            onClick={() => onViewDetail(campaign)}
                          />
                          
                          {campaign.status === 'draft' && campaign.total_recipients > 0 && (
                            <Button 
                              small 
                              minimal 
                              icon="play" 
                              intent={Intent.SUCCESS}
                              title="Iniciar"
                              onClick={() => handleStart(campaign.id)}
                            />
                          )}
                          
                          {campaign.status === 'running' && (
                            <Button 
                              small 
                              minimal 
                              icon="pause" 
                              intent={Intent.WARNING}
                              title="Pausar"
                              onClick={() => handlePause(campaign.id)}
                            />
                          )}
                          
                          {campaign.status === 'paused' && (
                            <Button 
                              small 
                              minimal 
                              icon="play" 
                              intent={Intent.SUCCESS}
                              title="Reanudar"
                              onClick={() => handleResume(campaign.id)}
                            />
                          )}
                          
                          {['draft', 'completed', 'failed'].includes(campaign.status) && (
                            <Button 
                              small 
                              minimal 
                              icon="trash" 
                              intent={Intent.DANGER}
                              title="Eliminar"
                              onClick={() => setDeleteConfirm(campaign)}
                            />
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </HTMLTable>
        </Card>
      )}

      {/* Confirmación de eliminación */}
      <Alert
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => handleDelete(deleteConfirm?.id)}
        cancelButtonText="Cancelar"
        confirmButtonText="Eliminar"
        intent={Intent.DANGER}
        icon="trash"
      >
        <p>
          ¿Estás seguro de que deseas eliminar la campaña <strong>"{deleteConfirm?.name}"</strong>?
        </p>
        <p>
          Esta acción eliminará todos los destinatarios y logs asociados. No se puede deshacer.
        </p>
      </Alert>

      {/* Modal de exportación */}
      <ExportModal 
        bp={bp}
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  )
}

export default CampaignList
