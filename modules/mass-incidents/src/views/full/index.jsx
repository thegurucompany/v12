import React, { useState, useEffect } from 'react'
import {
  Button,
  Intent,
  TextArea,
  Callout,
  Card,
  Elevation,
  Spinner,
  Classes,
  H3,
  H5,
  Tag,
  Toaster,
  Position
} from '@blueprintjs/core'

const toaster = Toaster.create({ position: Position.TOP })

const MassIncidentsPanel = ({ bp }) => {
  // Mensaje predeterminado para incidencias
  const DEFAULT_MESSAGE = '⚠ Estamos presentando una intermitencia en el servicio.\nNo es necesario que lo reportes, nuestro equipo ya está trabajando para resolverlo. 🙌'
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [currentIncident, setCurrentIncident] = useState(null)
  const [charCount, setCharCount] = useState(DEFAULT_MESSAGE.length)

  const MAX_CHARS = 5000

  // Obtener el botId desde la variable global de Botpress
  const botId = window.BOT_ID || window['BOT_ID']

  // Cargar estado actual al montar el componente
  useEffect(() => {
    loadIncidentStatus()
  }, [])

  const loadIncidentStatus = async () => {
    try {
      setLoading(true)
      const { data } = await bp.axios.get(`mod/mass-incidents/incidents`)

      if (data.success && data.data) {
        setCurrentIncident(data.data)
        // Cargar el mensaje guardado, esté activa o no la incidencia
        if (data.data.message) {
          setMessage(data.data.message)
          setCharCount(data.data.message.length)
        }
      }
    } catch (error) {
      console.error('[mass-incidents] Error loading status:', error)
      toaster.show({ message: 'Error al cargar el estado de la incidencia', intent: Intent.DANGER })
    } finally {
      setLoading(false)
    }
  }

  const handleMessageChange = e => {
    const newMessage = e.target.value
    if (newMessage.length <= MAX_CHARS) {
      setMessage(newMessage)
      setCharCount(newMessage.length)
    }
  }

  const handleActivate = async () => {
    if (!message.trim()) {
      toaster.show({ message: 'El mensaje no puede estar vacío', intent: Intent.DANGER })
      return
    }

    try {
      setSaving(true)
      const { data } = await bp.axios.post(`mod/mass-incidents/incidents`, { message: message.trim() })

      if (data.success) {
        toaster.show({ message: '¡Incidencia masiva activada exitosamente!', intent: Intent.SUCCESS })
        await loadIncidentStatus()
      } else {
        toaster.show({ message: data.error || 'Error al activar la incidencia', intent: Intent.DANGER })
      }
    } catch (error) {
      console.error('[mass-incidents] Error activating incident:', error)
      toaster.show({ message: 'Error al activar la incidencia', intent: Intent.DANGER })
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async () => {
    try {
      setSaving(true)
      const { data } = await bp.axios.delete(`mod/mass-incidents/incidents`)

      if (data.success) {
        toaster.show({ message: 'Incidencia desactivada correctamente', intent: Intent.SUCCESS })
        await loadIncidentStatus()
      } else {
        toaster.show({ message: data.error || 'Error al desactivar la incidencia', intent: Intent.DANGER })
      }
    } catch (error) {
      console.error('[mass-incidents] Error deactivating incident:', error)
      toaster.show({ message: 'Error al desactivar la incidencia', intent: Intent.DANGER })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
        <Spinner size={50} />
      </div>
    )
  }

  const isActive = currentIncident?.active || false

  return (
    <div className="mass-incidents-container" style={{ padding: '20px', maxWidth: '900px', margin: '0 auto', maxHeight: 'calc(100vh - 60px)', overflowY: 'auto' }}>
      <H3 style={{ marginBottom: '20px' }}>
        Gestión de Incidencias Masivas
        {isActive && (
          <Tag intent={Intent.DANGER} large style={{ marginLeft: '15px' }}>
            ACTIVA
          </Tag>
        )}
      </H3>

      {/* ADVERTENCIA CRÍTICA */}
      <Callout
        intent={Intent.DANGER}
        icon="warning-sign"
        title="⚠️ ADVERTENCIA CRÍTICA"
        style={{ marginBottom: '20px', fontSize: '14px' }}
      >
        <strong>Modificar esta configuración afectará la respuesta inicial para TODOS los usuarios del bot.</strong>
        <br />
        Este mensaje tendrá prioridad absoluta sobre cualquier flujo o saludo promocional.
        <br />
        <strong>Usar SOLO en casos de incidencias reales o mantenimiento programado.</strong>
      </Callout>

      {/* Estado actual */}
      {currentIncident && (
        <Card elevation={Elevation.TWO} style={{ marginBottom: '20px', backgroundColor: '#f5f8fa' }}>
          <H5>Estado Actual</H5>
          <div style={{ marginTop: '10px' }}>
            <div>
              <strong>Estado:</strong>{' '}
              {isActive ? <Tag intent={Intent.DANGER}>Activa</Tag> : <Tag intent={Intent.SUCCESS}>Inactiva</Tag>}
            </div>
            {currentIncident.createdBy && (
              <div style={{ marginTop: '5px' }}>
                <strong>Creada por:</strong> {currentIncident.createdBy}
              </div>
            )}
            {currentIncident.updatedAt && (
              <div style={{ marginTop: '5px' }}>
                <strong>Última actualización:</strong> {new Date(currentIncident.updatedAt).toLocaleString('es-ES')}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Editor de mensaje */}
      <Card elevation={Elevation.TWO} style={{ marginBottom: '20px' }}>
        <H5>Mensaje de Incidencia</H5>
        <p style={{ color: '#5c7080', fontSize: '13px', marginBottom: '10px' }}>
          Este mensaje será enviado proactivamente a todos los usuarios que interactúen con el bot.
        </p>

        <TextArea
          fill
          growVertically={false}
          large
          value={message}
          onChange={handleMessageChange}
          placeholder="Ej: Estimado usuario, nuestro sistema se encuentra en mantenimiento. Por favor, intente nuevamente en 30 minutos."
          style={{
            minHeight: '150px',
            fontFamily: 'monospace',
            fontSize: '13px',
            marginBottom: '10px'
          }}
          disabled={saving}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: charCount > MAX_CHARS * 0.9 ? '#db3737' : '#5c7080' }}>
            {charCount} / {MAX_CHARS} caracteres
          </span>
        </div>
      </Card>

      {/* Botones de acción */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <Button
          intent={Intent.SUCCESS}
          icon="upload"
          large
          onClick={handleActivate}
          disabled={saving || !message.trim()}
          loading={saving}
        >
          {isActive ? 'Actualizar Mensaje' : 'Activar Incidencia'}
        </Button>

        {isActive && (
          <Button
            intent={Intent.DANGER}
            icon="disable"
            large
            onClick={handleDeactivate}
            disabled={saving}
            loading={saving}
          >
            Desactivar Incidencia
          </Button>
        )}
      </div>


    </div>
  )
}

export default MassIncidentsPanel
