import { Dialog, Classes, Button, Intent, HTMLTable, Spinner, Position, Tooltip } from '@blueprintjs/core'
import axios from 'axios'
import { lang } from 'botpress/shared'
import moment from 'moment'
import React, { FC, useEffect, useState } from 'react'

interface ResolutionModalProps {
  isOpen: boolean
  onClose: () => void
  resolutionType: 'resolved' | 'unresolved'
  dateRange: [Date, Date]
  bp: any
}

interface Conversation {
  conversation_id: string
  full_name: string
}

interface ConversationsResponse {
  conversations: Conversation[]
  total: number
  page: number
  pageSize: number
}

const ResolutionModal: FC<ResolutionModalProps> = ({ isOpen, onClose, resolutionType, dateRange, bp }) => {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalConversations, setTotalConversations] = useState(0)

  const pageSize = 25

  const fetchConversations = async (page: number = 1) => {
    if (!dateRange[0] || !dateRange[1]) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const startDate = moment(dateRange[0]).unix()
      const endDate = moment(dateRange[1]).unix()

      const { data } = await bp.axios.get(`mod/analytics/conversations-by-resolution/${window.BOT_ID}`, {
        params: {
          start: startDate,
          end: endDate,
          type: resolutionType,
          page,
          pageSize
        }
      })

      setConversations(data.conversations || [])
      setTotalConversations(data.total || 0)
      setCurrentPage(data.page || page)
    } catch (err) {
      console.error('Error fetching conversations:', err)
      setError('No se pudieron cargar las conversaciones')
      setConversations([])
      setTotalConversations(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1)
      fetchConversations(1)
    }
  }, [isOpen, resolutionType, dateRange])

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(totalConversations / pageSize)) {
      fetchConversations(newPage)
    }
  }

  const handleConversationClick = (conversation: Conversation) => {
    onClose()
    // Usar el full_name en el searchText para que HITL busque la conversación
    const searchParam = conversation.full_name || conversation.conversation_id
    const botId = window.BOT_ID || window['BOT_ID']
    window.location.href = `/studio/${botId}/modules/hitl?searchText=${encodeURIComponent(searchParam)}`
  }

  const getTitle = () => {
    return resolutionType === 'resolved' ? 'Conversaciones Resueltas' : 'Conversaciones No Resueltas'
  }

  const getStartIndex = () => {
    return (currentPage - 1) * pageSize + 1
  }

  const getEndIndex = () => {
    const end = (currentPage - 1) * pageSize + conversations.length
    return Math.min(end, totalConversations)
  }

  const totalPages = Math.ceil(totalConversations / pageSize)

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={getTitle()} className={Classes.DIALOG} style={{ width: '600px' }}>
      <div className={Classes.DIALOG_BODY}>
        {loading && conversations.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
            <Spinner size={50} />
          </div>
        ) : error ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#d14319' }}>{error}</div>
        ) : (
          <>
            <div style={{ marginBottom: '15px', fontSize: '14px', color: '#666' }}>
              {totalConversations > 0
                ? `Mostrando ${getStartIndex()}-${getEndIndex()} de ${totalConversations} conversaciones`
                : 'No se encontraron conversaciones'}
            </div>

            {conversations.length > 0 && (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <HTMLTable striped interactive style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '50%' }}>ID de Conversación</th>
                      <th style={{ width: '50%' }}>Nombre del Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversations.map((conversation, index) => (
                      <tr
                        key={`${conversation.conversation_id}-${index}`}
                        onClick={() => handleConversationClick(conversation)}
                        style={{
                          cursor: 'pointer',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.backgroundColor = '#f5f5f5'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.backgroundColor = ''
                        }}
                      >
                        <td>
                          <Tooltip content="Click para ver en HITL" position={Position.TOP}>
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                color: '#0073b7'
                              }}
                            >
                              {conversation.conversation_id}
                            </span>
                          </Tooltip>
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 500,
                              color: '#333'
                            }}
                          >
                            {conversation.full_name || 'Usuario desconocido'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </HTMLTable>
              </div>
            )}
          </>
        )}
      </div>

      {!loading && !error && totalPages > 1 && (
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '14px',
                color: '#666'
              }}
            >
              <Button
                icon="chevron-left"
                disabled={currentPage === 1}
                onClick={() => handlePageChange(currentPage - 1)}
                minimal
              >
                Anterior
              </Button>

              <span>
                Página {currentPage} de {totalPages}
              </span>

              <Button
                icon="chevron-right"
                disabled={currentPage === totalPages}
                onClick={() => handlePageChange(currentPage + 1)}
                minimal
              >
                Siguiente
              </Button>
            </div>

            <Button intent={Intent.NONE} onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      )}

      {loading && conversations.length > 0 && (
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '14px',
                color: '#666'
              }}
            >
              <Spinner size={16} />
              <span>Cargando...</span>
            </div>

            <Button intent={Intent.NONE} onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && totalPages <= 1 && (
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button intent={Intent.NONE} onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default ResolutionModal
