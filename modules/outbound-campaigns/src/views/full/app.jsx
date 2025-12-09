import React, { useState, useEffect, useCallback } from 'react'
import {
  Spinner,
  Callout,
  Intent,
  NonIdealState,
  H3,
  Icon,
  Button,
  Toaster,
  Position
} from '@blueprintjs/core'

import CampaignList from './CampaignList.jsx'
import CampaignForm from './CampaignForm.jsx'
import CampaignDetail from './CampaignDetail.jsx'

import './style.scss'

const toaster = Toaster.create({ position: Position.TOP })

/**
 * Componente principal del módulo Outbound Campaigns
 * 
 * Maneja:
 * - Verificación de estado (Vonage configurado)
 * - Navegación entre vistas (lista, detalle)
 * - Estado global de campañas
 */
const OutboundCampaignsPanel = ({ bp }) => {
  // Estados principales
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [campaigns, setCampaigns] = useState([])
  const [error, setError] = useState(null)

  // Estados de navegación
  const [view, setView] = useState('list') // 'list' | 'detail'
  const [selectedCampaign, setSelectedCampaign] = useState(null)

  // Estados de modales
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState(null)

  const botId = window.BOT_ID || window['BOT_ID']

  // Verificar estado del módulo al cargar
  useEffect(() => {
    checkStatus()
  }, [])

  // Verificar si Vonage está configurado
  const checkStatus = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const { data } = await bp.axios.get('mod/outbound-campaigns/status')
      
      if (data.success) {
        setEnabled(data.enabled)
        if (data.enabled) {
          await loadCampaigns()
        }
      } else {
        setError(data.error || 'Error al verificar el estado del módulo')
      }
    } catch (err) {
      console.error('[outbound-campaigns] Error checking status:', err)
      setError('Error al verificar el estado del módulo')
    } finally {
      setLoading(false)
    }
  }

  // Cargar lista de campañas
  const loadCampaigns = useCallback(async () => {
    try {
      const { data } = await bp.axios.get('mod/outbound-campaigns/campaigns')
      if (data.success) {
        setCampaigns(data.campaigns || [])
      } else {
        console.error('Error loading campaigns:', data.error)
      }
    } catch (err) {
      console.error('[outbound-campaigns] Error loading campaigns:', err)
    }
  }, [bp])

  // Manejar creación de nueva campaña
  const handleCreateNew = () => {
    setEditingCampaign(null)
    setShowCreateForm(true)
  }

  // Manejar edición de campaña
  const handleEditCampaign = (campaign) => {
    setEditingCampaign(campaign)
    setShowCreateForm(true)
  }

  // Manejar visualización de detalle
  const handleViewDetail = (campaign) => {
    setSelectedCampaign(campaign)
    setView('detail')
  }

  // Volver a la lista
  const handleBackToList = () => {
    setView('list')
    setSelectedCampaign(null)
    loadCampaigns()
  }

  // Callback cuando se crea/edita una campaña exitosamente
  const handleFormSuccess = (campaign) => {
    loadCampaigns()
    
    // Si se creó una nueva, ir al detalle para subir CSV
    if (!editingCampaign && campaign) {
      setSelectedCampaign(campaign)
      setView('detail')
    }
  }

  // Renderizar estado de carga
  if (loading) {
    return (
      <div className="outbound-campaigns-loading">
        <Spinner size={50} />
        <p>Cargando módulo...</p>
      </div>
    )
  }

  // Renderizar si Vonage no está configurado
  if (!enabled) {
    return (
      <div className="outbound-campaigns-container">
        <NonIdealState
          icon="disable"
          title="Módulo no disponible"
          description={
            <div>
              <p>Las credenciales de Vonage no están configuradas para este bot.</p>
              <p>Para habilitar las campañas salientes, configura Vonage en <code>bot.config.json</code>:</p>
              <pre style={{ textAlign: 'left', marginTop: '10px', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
{`"messaging": {
  "channels": {
    "vonage": {
      "apiKey": "tu-api-key",
      "apiSecret": "tu-api-secret",
      "applicationId": "tu-app-id",
      "privateKey": "...",
      "whatsappNumber": "+521234567890"
    }
  }
}`}
              </pre>
            </div>
          }
        />
      </div>
    )
  }

  // Renderizar error
  if (error) {
    return (
      <div className="outbound-campaigns-container">
        <Callout intent={Intent.DANGER} title="Error" icon="error">
          {error}
          <br />
          <Button 
            text="Reintentar" 
            intent={Intent.PRIMARY} 
            onClick={checkStatus}
            style={{ marginTop: '10px' }}
          />
        </Callout>
      </div>
    )
  }

  // Renderizar vista de detalle
  if (view === 'detail' && selectedCampaign) {
    return (
      <div className="outbound-campaigns-container">
        <CampaignDetail
          bp={bp}
          campaign={selectedCampaign}
          onBack={handleBackToList}
          onEdit={() => handleEditCampaign(selectedCampaign)}
        />

        <CampaignForm
          bp={bp}
          isOpen={showCreateForm}
          onClose={() => {
            setShowCreateForm(false)
            setEditingCampaign(null)
          }}
          onSuccess={handleFormSuccess}
          campaign={editingCampaign}
        />
      </div>
    )
  }

  // Renderizar vista de lista (default)
  return (
    <div className="outbound-campaigns-container">
      <div className="outbound-campaigns-header">
        <H3>
          <Icon icon="send-message" /> Campañas Salientes
        </H3>
      </div>

      <CampaignList
        bp={bp}
        campaigns={campaigns}
        onRefresh={loadCampaigns}
        onCreateNew={handleCreateNew}
        onViewDetail={handleViewDetail}
      />

      <CampaignForm
        bp={bp}
        isOpen={showCreateForm}
        onClose={() => {
          setShowCreateForm(false)
          setEditingCampaign(null)
        }}
        onSuccess={handleFormSuccess}
        campaign={editingCampaign}
      />
    </div>
  )
}

export default OutboundCampaignsPanel
