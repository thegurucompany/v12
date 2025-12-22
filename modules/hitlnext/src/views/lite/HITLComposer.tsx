import { Button, Menu, MenuItem, Popover, Position, InputGroup } from '@blueprintjs/core'
import ReactTextareaAutocomplete from '@webscopeio/react-textarea-autocomplete'
import cx from 'classnames'
import React, { FC, useEffect, useState } from 'react'

import { IAutoComplete, IShortcut } from '../../config'
import { makeClient, IMacro } from '../client'
import lang from '../lang'

import FileUpload from './FileUpload'
import style from './style.scss'

// Helper function to get appropriate emoji for file types
const getFileEmoji = (fileType: string, fileExtension: string): string => {
  // Check by MIME type first
  if (fileType.startsWith('image/')) {
    return '🖼️'
  }
  if (fileType.startsWith('video/')) {
    return '🎥'
  }
  if (fileType.startsWith('audio/')) {
    return '🎵'
  }
  if (fileType.includes('pdf')) {
    return '📋'
  }
  if (fileType.includes('word') || fileType.includes('document')) {
    return '📝'
  }
  if (fileType.includes('excel') || fileType.includes('spreadsheet')) {
    return '📊'
  }
  if (fileType.includes('powerpoint') || fileType.includes('presentation')) {
    return '📈'
  }
  if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('compressed')) {
    return '🗜️'
  }

  // Check by file extension if MIME type doesn't match
  switch (fileExtension) {
    case 'pdf':
      return '📋'
    case 'doc':
    case 'docx':
      return '📝'
    case 'xls':
    case 'xlsx':
      return '📊'
    case 'ppt':
    case 'pptx':
      return '📈'
    case 'zip':
    case 'rar':
    case '7z':
      return '🗜️'
    case 'txt':
      return '📄'
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
      return '🖼️'
    case 'mp4':
    case 'avi':
    case 'mov':
      return '🎥'
    case 'mp3':
    case 'wav':
    case 'flac':
      return '🎵'
    default:
      return '📁'
  }
}

// store here is the whole webchat store
// reference here: modules/channel-web/src/views/lite/store/index.ts
interface ComposerProps {
  name: string
  store: {
    bp: any
    composer: any
    sendMessage: () => Promise<void>
    currentConversation?: {
      id: string
      userId: string
    }
  }
}

interface ShortcutItemProps {
  selected: boolean
  trigger: string
  entity: IShortcut
}
const ShortcutItem: FC<ShortcutItemProps> = props => (
  <div className={cx(style.shortcutItem, { [style.selected]: props.selected })}>
    <span className={style.shortcutKey}>{`${props.trigger}${props.entity.name}`}</span>
    <span className={style.shortcutValue}>{`${props.entity.value}`}</span>
  </div>
)

const HITLComposer: FC<ComposerProps> = props => {
  const [autoComplete, setAutoComplete] = useState<IAutoComplete>()
  const [isLoading, setIsLoading] = useState(true)
  const [text, setText] = useState<string>('')
  const [uploadedFile, setUploadedFile] = useState<{ url: string; name: string; type: string } | null>(null)
  const [currentAgent, setCurrentAgent] = useState<any>(null)
  const [activeHandoff, setActiveHandoff] = useState<any>(null)
  const [macros, setMacros] = useState<IMacro[]>([])
  const [filteredMacros, setFilteredMacros] = useState<IMacro[]>([])
  const [macroSearch, setMacroSearch] = useState('')
  const [isMacrosPopoverOpen, setIsMacrosPopoverOpen] = useState(false)

  const hitlClient = makeClient(props.store.bp)

  const fetchShortcuts = async () => {
    try {
      const configs = await hitlClient.getConfig()
      setAutoComplete(configs.autoComplete)
    } catch {
      console.error('could not fetch module config')
    }
  }

  const fetchCurrentAgent = async () => {
    try {
      const agent = await hitlClient.getCurrentAgent()
      setCurrentAgent(agent)
    } catch {
      console.error('could not fetch current agent')
    }
  }

  const fetchActiveHandoff = async () => {
    try {
      if (!props.store.currentConversation?.userId) {
        return
      }

      const handoffs = await hitlClient.getHandoffs()
      const activeHandoff = handoffs.find(
        h => h.userId === props.store.currentConversation?.userId && (h.status === 'assigned' || h.status === 'pending')
      )

      setActiveHandoff(activeHandoff)
    } catch (error) {
      console.error('Error fetching active handoff:', error)
    }
  }

  const fetchMacros = async () => {
    try {
      const macrosData = await hitlClient.getMacros()
      setMacros(macrosData)
      setFilteredMacros(macrosData)
    } catch (error) {
      console.error('Error fetching macros:', error)
      // Set empty array on error so button is not disabled due to undefined
      setMacros([])
      setFilteredMacros([])
    }
  }

  function hasPermission(): boolean {
    // Supervisors and admins should always have access even if not "online" as agents
    const isSupervisorOrAdmin = currentAgent?.role === 'supervisor' || currentAgent?.role === 'admin'
    if (isSupervisorOrAdmin) {
      return true
    }
    // For agents, check online status
    return currentAgent?.online === true
  }

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchShortcuts().finally(() => setIsLoading(false))
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchCurrentAgent()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchActiveHandoff()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchMacros()
  }, [])

  const sendHitlComment = async (content: string, uploadUrl?: string): Promise<void> => {
    if (!activeHandoff) {
      console.error('No active handoff found')
      return
    }

    try {
      await hitlClient.createComment(activeHandoff.id, {
        content,
        uploadUrl
      })

      // Show success message
      props.store.bp.toast?.show({
        message: lang.tr('module.hitlnext.composer.messageSent'),
        intent: 'success'
      })
    } catch (error) {
      console.error('Error sending HITL comment:', error)
    }
  }

  const sendWebchatMessage = async (): Promise<void> => {
    if (uploadedFile) {
      // Send file message directly through the composer
      if (uploadedFile.type.startsWith('image/')) {
        // For images, send as image message without text to avoid duplicate messages
        props.store.composer.updateMessage({
          type: 'image',
          title: uploadedFile.name,
          image: uploadedFile.url,
          metadata: {
            uploadUrl: uploadedFile.url,
            fileName: uploadedFile.name,
            fileType: uploadedFile.type
          }
        })
      } else {
        // For other files, send as file message with attractive copy
        const fileExtension =
          uploadedFile.name
            .split('.')
            .pop()
            ?.toLowerCase() || 'archivo'
        const fileEmoji = getFileEmoji(uploadedFile.type, fileExtension)

        props.store.composer.updateMessage({
          type: 'file',
          text: `${fileEmoji} *Archivo compartido:* ${uploadedFile.name}\n\n📄 ${
            uploadedFile.url
          }\n\n*Tipo: ${fileExtension.toUpperCase()}*`,
          title: uploadedFile.name,
          url: uploadedFile.url,
          metadata: {
            uploadUrl: uploadedFile.url,
            fileName: uploadedFile.name,
            fileType: uploadedFile.type
          }
        })
      }

      await props.store.sendMessage()

      // Clear the uploaded file after successful send
      setUploadedFile(null)
    } else if (text.trim()) {
      // Send text message
      props.store.composer.updateMessage(text.trim())
      await props.store.sendMessage()

      setText('')
    }
  }

  const sendMessage = async (): Promise<void> => {
    if (!canSendMessage()) {
      return
    }

    // Si hay un handoff activo, usar el sistema de comentarios
    if (activeHandoff && (activeHandoff.status === 'assigned' || activeHandoff.status === 'pending')) {
      if (uploadedFile) {
        const content = uploadedFile.type.startsWith('image/')
          ? `Imagen: ${uploadedFile.name}`
          : `Archivo: ${uploadedFile.name}`

        await sendHitlComment(content, uploadedFile.url)
        setUploadedFile(null)
      } else if (text.trim()) {
        await sendHitlComment(text.trim())
        setText('')
      }
    } else {
      // Si no hay handoff activo, usar el webchat normal
      await sendWebchatMessage()
    }
  }

  const handleUploadComplete = (uploadUrl: string, fileName: string, fileType: string) => {
    setUploadedFile({ url: uploadUrl, name: fileName, type: fileType })
  }

  const handleChange: React.ChangeEventHandler<HTMLTextAreaElement> = event => {
    setText(event.target.value)
  }

  const handleKeyDown: React.EventHandler<React.KeyboardEvent> = event => {
    if (event.shiftKey) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault() // prevent \n
      sendMessage().catch(() => console.error('could not send message'))
    }
  }

  const handleMacroSearch = (searchValue: string) => {
    setMacroSearch(searchValue)
    if (!searchValue.trim()) {
      setFilteredMacros(macros)
    } else {
      const filtered = macros.filter(
        macro =>
          macro.name.toLowerCase().includes(searchValue.toLowerCase()) ||
          macro.content.toLowerCase().includes(searchValue.toLowerCase())
      )
      setFilteredMacros(filtered)
    }
  }

  const handleMacroSelect = (macro: IMacro) => {
    setText(macro.content)
    setIsMacrosPopoverOpen(false)
    setMacroSearch('')
    setFilteredMacros(macros)
  }

  const canSendMessage = (): boolean => text.trim().length > 0 || uploadedFile !== null

  const canSendText = (): boolean => text.trim().length > 0

  const getMacrosButtonTitle = (): string => {
    if (!hasPermission()) {
      return 'Debes estar en línea para usar macros'
    }
    if (macros.length === 0) {
      return 'No hay macros disponibles'
    }
    return lang.tr('module.hitlnext.macros.button')
  }

  return (
    !isLoading && (
      <div id="shortcutContainer" className={style.composerContainer}>
        {uploadedFile && (
          <div className={style.filePreview}>
            {uploadedFile.type.startsWith('image/') ? (
              <img src={uploadedFile.url} alt={uploadedFile.name} className={style.imagePreview} />
            ) : (
              <div className={style.fileIcon}>📎 {uploadedFile.name}</div>
            )}
            <Button
              className={style.removeFileButton}
              icon="cross"
              minimal
              small
              onClick={() => setUploadedFile(null)}
            />
          </div>
        )}
        <div className={style.inputRow}>
          <FileUpload bp={props.store.bp} onUploadComplete={handleUploadComplete} disabled={!hasPermission()} />

          <Popover
            content={
              <Menu className={style.macrosMenu}>
                <div className={style.macrosSearch}>
                  <InputGroup
                    leftIcon="search"
                    placeholder={lang.tr('module.hitlnext.macros.searchPlaceholder')}
                    value={macroSearch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleMacroSearch(e.target.value)}
                    small
                  />
                </div>
                <div className={style.macrosListContainer}>
                  {filteredMacros.length === 0 ? (
                    <MenuItem
                      disabled
                      text={
                        macroSearch
                          ? lang.tr('module.hitlnext.macros.noMacros')
                          : lang.tr('module.hitlnext.macros.noMacros')
                      }
                    />
                  ) : (
                    filteredMacros.map(macro => (
                      <MenuItem
                        key={macro.id}
                        text={macro.name}
                        label={macro.content.length > 50 ? `${macro.content.substring(0, 50)}...` : macro.content}
                        onClick={() => handleMacroSelect(macro)}
                        className={style.macroItem}
                      />
                    ))
                  )}
                </div>
              </Menu>
            }
            position={Position.TOP}
            isOpen={isMacrosPopoverOpen}
            onInteraction={state => setIsMacrosPopoverOpen(state)}
            disabled={!hasPermission() || macros.length === 0}
          >
            <Button
              className={style.macrosButton}
              icon="flash"
              minimal
              small
              title={getMacrosButtonTitle()}
              disabled={!hasPermission() || macros.length === 0}
            />
          </Popover>

          <ReactTextareaAutocomplete
            containerClassName={cx('bpw-composer', style.composer)}
            className={cx('bpw-composer-inner')}
            dropdownClassName={style.shortcutDropdown}
            itemClassName={style.shortcutListItem}
            loadingComponent={() => null}
            minChar={0}
            placeholder={lang.tr('module.hitlnext.conversation.composerPlaceholder')}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            scrollToItem={false}
            disabled={!hasPermission()}
            trigger={{
              [autoComplete.trigger]: {
                dataProvider: (token: string) =>
                  autoComplete.shortcuts.filter(s => s.name.toLowerCase().includes(token)),
                component: props => <ShortcutItem {...props} trigger={autoComplete.trigger} />,
                output: (s: IShortcut) => s.value
              }
            }}
          />
          <Button className={style.sendButton} disabled={!canSendMessage() || !hasPermission()} onClick={sendMessage}>
            {lang.tr('module.hitlnext.conversation.send')}
          </Button>
        </div>
      </div>
    )
  )
}

export default HITLComposer
