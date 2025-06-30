import { Button } from '@blueprintjs/core'
import ReactTextareaAutocomplete from '@webscopeio/react-textarea-autocomplete'
import cx from 'classnames'
import React, { FC, useEffect, useState } from 'react'

import { IAutoComplete, IShortcut } from '../../config'
import { makeClient } from '../client'
import lang from '../lang'

import FileUpload from './FileUpload'
import style from './style.scss'

// store here is the whole webchat store
// reference here: modules/channel-web/src/views/lite/store/index.ts
interface ComposerProps {
  name: string
  store: {
    bp: any
    composer: any
    sendMessage: () => Promise<void>
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

  function hasPermission(): boolean {
    return currentAgent?.online === true
  }

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchShortcuts().finally(() => setIsLoading(false))
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchCurrentAgent()
  }, [])

  const sendMessage = async (): Promise<void> => {
    if (!canSendMessage()) {
      return
    }

    if (uploadedFile) {
      // Send file message directly through the composer
      if (uploadedFile.type.startsWith('image/')) {
        // For images, send as image message
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
        // For other files, send as file message
        props.store.composer.updateMessage({
          type: 'file',
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
      
      // Show confirmation message and force immediate display
      if (uploadedFile.type.startsWith('image/')) {
        props.store.bp.toast?.show({
          message: lang.tr('module.hitlnext.composer.imageSent'),
          intent: 'success'
        })
      } else {
        props.store.bp.toast?.show({
          message: lang.tr('module.hitlnext.composer.fileSent'),
          intent: 'success'
        })
      }

      setUploadedFile(null)
    } else if (text.trim()) {
      // Send text message
      props.store.composer.updateMessage(text.trim())
      await props.store.sendMessage()
      
      // Show confirmation message for text
      props.store.bp.toast?.show({
        message: lang.tr('module.hitlnext.composer.messageSent'),
        intent: 'success'
      })

      setText('')
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

  const canSendMessage = (): boolean => text.trim().length > 0 || uploadedFile !== null

  const canSendText = (): boolean => text.trim().length > 0

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
