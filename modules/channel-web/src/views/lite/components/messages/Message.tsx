import classnames from 'classnames'
import pick from 'lodash/pick'
import { inject, observer } from 'mobx-react'
import React, { Component } from 'react'
import { InjectedIntlProps, injectIntl } from 'react-intl'

import { RootStore, StoreDef } from '../../store'
import { Renderer } from '../../typings'
import { showContextMenu } from '../ContextMenu'
import * as Keyboard from '../Keyboard'

import { Carousel, FileMessage, LoginPrompt, Text, VoiceMessage } from './renderer'
import { Dropdown } from './renderer/Dropdown'

class Message extends Component<MessageProps> {
  state = {
    hasError: false,
    showMore: false
  }

  static getDerivedStateFromError(error: Error) {
    console.error('Message rendering error:', error)
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Message component error details:', error, errorInfo)
    console.error('Payload that caused error:', this.props.payload)
    console.error('Message type:', this.props.type)
  }

  render_text(textMessage?: string) {
    const { text, markdown } = this.props.payload
    const message = textMessage || text

    return (
      <Text
        markdown={markdown}
        text={message}
        intl={this.props.intl}
        maxLength={this.props.payload.trimLength}
        escapeHTML={this.props.store.escapeHTML}
        isBotMessage={this.props.isBotMessage}
      />
    )
  }

  render_quick_reply() {
    return this.render_text()
  }

  render_login_prompt() {
    return (
      <LoginPrompt
        isLastMessage={this.props.isLastGroup && this.props.isLastOfGroup}
        isBotMessage={this.props.isBotMessage}
        onSendData={this.props.onSendData}
      />
    )
  }

  render_carousel() {
    return (
      <Carousel
        onSendData={this.props.onSendData}
        carousel={this.props.payload}
        escapeHTML={this.props.store.escapeHTML}
        isBotMessage={this.props.isBotMessage}
        intl={this.props.intl}
      />
    )
  }

  render_typing() {
    return (
      <div className={'bpw-typing-group'}>
        <div className={'bpw-typing-bubble'} />
        <div className={'bpw-typing-bubble'} />
        <div className={'bpw-typing-bubble'} />
      </div>
    )
  }

  render_audio() {
    return <FileMessage file={this.props.payload} escapeTextHTML={this.props.store.escapeHTML} />
  }

  render_video() {
    return <FileMessage file={this.props.payload} escapeTextHTML={this.props.store.escapeHTML} />
  }

  render_image() {
    try {
      const { payload } = this.props

      // Handle different payload structures
      let fileData = null

      if (payload?.image) {
        // Handle when image is directly a URL string
        if (typeof payload.image === 'string') {
          fileData = {
            url: payload.image,
            title: 'Imagen',
            storage: 's3',
            text: payload.text || ''
          }
        } else if (typeof payload.image === 'object') {
          fileData = {
            url: payload.image.url || payload.image,
            title: payload.image.title || 'Imagen',
            storage: payload.image.storage || 's3',
            text: payload.image.text || payload.text || ''
          }
        }
      } else if (payload?.url) {
        // Standard image payload structure
        fileData = {
          url: payload.url,
          title: 'Imagen',
          storage: 's3',
          text: payload.text || ''
        }
      }

      if (!fileData || (!fileData.url && !fileData.image)) {
        return (
          <div style={{ padding: '8px', backgroundColor: '#ffebee', border: '1px solid #ffcdd2', borderRadius: '4px' }}>
            <span style={{ color: '#c62828' }}>❌ No se pudo cargar la imagen</span>
            {payload?.title && <div style={{ fontSize: '12px', color: '#666' }}>{payload.title}</div>}
          </div>
        )
      }

      // Ensure the image URL is in the correct property
      if (fileData.image && !fileData.url) {
        fileData.url = fileData.image
      }

      return <FileMessage file={fileData} escapeTextHTML={this.props.store.escapeHTML} />
    } catch (error) {
      console.error('Error rendering image message:', error, this.props.payload)
      return (
        <div style={{ padding: '8px', backgroundColor: '#ffebee', border: '1px solid #ffcdd2', borderRadius: '4px' }}>
          <span style={{ color: '#c62828' }}>❌ Error al renderizar imagen</span>
        </div>
      )
    }
  }

  render_file() {
    try {
      const { payload } = this.props

      // Handle different payload structures
      let fileData = null

      if (payload?.url) {
        // Standard file payload structure - prioritize direct URL
        fileData = {
          url: payload.url,
          title: 'Archivo',
          storage: 's3',
          text: payload.text || ''
        }
      } else if (payload?.file) {
        // Handle when file is directly a URL string or an object
        if (typeof payload.file === 'string') {
          fileData = {
            url: payload.file,
            title: 'Archivo',
            storage: 's3',
            text: payload.text || ''
          }
        } else if (typeof payload.file === 'object') {
          // Alternative structure where file data is nested in file property
          fileData = {
            url: payload.file.url || payload.file,
            title: payload.file.title || 'Archivo',
            storage: payload.file.storage || 's3',
            text: payload.file.text || payload.text || ''
          }
        }
      }

      if (!fileData || !fileData.url) {
        return (
          <div style={{ padding: '8px', backgroundColor: '#fff3e0', border: '1px solid #ffcc02', borderRadius: '4px' }}>
            <span style={{ color: '#ef6c00' }}>📎 No se pudo cargar el archivo</span>
            {payload?.title && <div style={{ fontSize: '12px', color: '#666' }}>{payload.title}</div>}
          </div>
        )
      }

      // Check if it's actually an image file
      if (
        fileData.url &&
        typeof fileData.url === 'string' &&
        fileData.url.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
      ) {
        // If it's an image, add image property for FileMessage to handle it correctly
        fileData.image = fileData.url
      }

      return <FileMessage file={fileData} escapeTextHTML={this.props.store.escapeHTML} />
    } catch (error) {
      console.error('Error rendering file message:', error, this.props.payload)
      return (
        <div style={{ padding: '8px', backgroundColor: '#ffebee', border: '1px solid #ffcdd2', borderRadius: '4px' }}>
          <span style={{ color: '#c62828' }}>❌ Error al renderizar archivo</span>
        </div>
      )
    }
  }

  render_voice() {
    return (
      <VoiceMessage
        file={this.props.payload}
        shouldPlay={this.props.shouldPlay}
        onAudioEnded={this.props.onAudioEnded}
      />
    )
  }

  render_custom() {
    const { module = undefined, component = undefined, wrapped = undefined } = this.props.payload || {}
    if (!module || !component) {
      return this.render_unsupported()
    }

    // TODO: Remove eventually, it's for backward compatibility
    if (module === 'extensions' && component === 'Dropdown') {
      return this.render_dropdown()
    }

    const InjectedModuleView = this.props.store.bp.getModuleInjector()

    const messageDataProps = { ...this.props.payload }
    delete messageDataProps.module
    delete messageDataProps.component

    const sanitizedProps = pick(this.props, [
      'messageId',
      'isLastGroup',
      'isLastOfGroup',
      'isBotMessage',
      'onSendData',
      'onFileUpload',
      'sentOn',
      'store',
      'className',
      'intl'
    ])

    const props = {
      ...sanitizedProps,
      ...messageDataProps,
      keyboard: Keyboard,
      children: wrapped && <Message {...sanitizedProps} keyboard={Keyboard} noBubble payload={wrapped} />
    }

    return <InjectedModuleView moduleName={module} componentName={component} lite extraProps={props} />
  }

  render_session_reset() {
    return this.render_text(this.props.store.intl.formatMessage({ id: 'store.resetSessionMessage' }))
  }

  render_visit() {
    return null
  }

  render_location() {
    const { payload } = this.props
    const latitude = payload?.latitude
    const longitude = payload?.longitude
    const address = payload?.address
    const title = payload?.title

    if (latitude !== undefined && longitude !== undefined) {
      return (
        <div style={{ padding: '8px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>📍 {title || address || 'Ubicación'}</div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            <div>Latitud: {latitude}</div>
            <div>Longitud: {longitude}</div>
          </div>
        </div>
      )
    }

    return (
      <div style={{ padding: '8px' }}>
        <div style={{ fontWeight: 'bold' }}>📍 {title || address || 'Ubicación'}</div>
      </div>
    )
  }

  render_unsupported() {
    return '*Unsupported message type*'
  }

  render_dropdown() {
    return <Dropdown {...this.props} {...this.props.payload} escapeHTML={this.props.store.escapeHTML}></Dropdown>
  }

  // Enhanced handlers for file and image messages from WhatsApp/Vonage
  render_whatsapp_image() {
    const { payload } = this.props

    // Handle different payload structures from WhatsApp/Vonage
    const imageUrl = payload?.image || payload?.url
    const title = payload?.title || payload?.name || 'Image'

    if (!imageUrl) {
      return this.render_unsupported()
    }

    const fileData = {
      url: imageUrl,
      title,
      storage: 's3', // Default to s3 since you're using S3 integration
      text: payload?.text || ''
    }

    return <FileMessage file={fileData} escapeTextHTML={this.props.store.escapeHTML} />
  }

  render_whatsapp_file() {
    const { payload } = this.props

    // Handle different payload structures from WhatsApp/Vonage
    const fileUrl = payload?.url || payload?.file || payload?.document
    const title = payload?.title || payload?.name || payload?.filename || 'File'

    if (!fileUrl) {
      return this.render_unsupported()
    }

    const fileData = {
      url: fileUrl,
      title,
      storage: 's3', // Default to s3 since you're using S3 integration
      text: payload?.text || ''
    }

    return <FileMessage file={fileData} escapeTextHTML={this.props.store.escapeHTML} />
  }

  handleContextMenu = e => {
    showContextMenu(e, this.props)
  }

  renderTimestamp() {
    if (!this.props.sentOn) {
      return null
    }

    // Only show timestamp in HITL context (agent-user chat), not in emulator or regular web
    const isEmulator = this.props.store.config.isEmulator

    // Detect HITL context using specific indicators
    const isHITLContext =
      // Check for HITL-specific userIdScope
      this.props.store.config.userIdScope === 'hitlnext' ||
      // Check URL patterns for HITL module
      window.location.pathname.includes('/hitl') ||
      window.location.pathname.includes('/agent') ||
      window.location.href.includes('module=hitl') ||
      window.location.href.includes('module=hitlnext') ||
      // Check if we're in admin interface with conversations
      (window.location.pathname.includes('/admin') && window.location.pathname.includes('conversation'))

    if (isEmulator || !isHITLContext) {
      return null
    }

    const timestamp = new Date(this.props.sentOn)
    const formattedDate = this.props.store.intl.formatDate(timestamp, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const formattedTime = this.props.store.intl.formatTime(timestamp, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })

    const type = this.props.type || (this.props.payload && this.props.payload.type)
    const isSessionReset = type === 'session_reset'

    return (
      <div className={`bpw-message-timestamp ${isSessionReset ? 'bpw-timestamp-center' : ''}`}>
        {`${formattedDate} ${formattedTime}`}
      </div>
    )
  }

  async onMessageClicked() {
    await this.props.store.loadEventInDebugger(this.props.messageId, true)
  }

  componentDidMount() {
    this.props.isLastGroup &&
      this.props.isLastOfGroup &&
      this.props.store.composer.setLocked(this.props.payload.disableFreeText)
  }

  render() {
    if (this.state.hasError) {
      return '* Cannot display message *'
    }

    const type = this.props.type || (this.props.payload && this.props.payload.type)
    const wrappedType = this.props.payload && this.props.payload.wrapped && this.props.payload.wrapped.type
    const renderer = (this[`render_${type}`] || this.render_unsupported).bind(this)
    const wrappedClass = `bpw-bubble-${wrappedType}`
    const isEmulator = this.props.store.config.isEmulator
    const isSessionReset = type === 'session_reset'

    const rendered = renderer()
    if (rendered === null) {
      return null
    }

    const additionalStyle = (this.props.payload && this.props.payload['web-style']) || {}

    if (this.props.noBubble || this.props.payload?.wrapped?.noBubble) {
      return (
        <div className={classnames(this.props.className, wrappedClass)} style={additionalStyle}>
          {rendered}
          {isSessionReset && this.renderTimestamp()}
        </div>
      )
    }

    return (
      <div
        className={classnames(this.props.className, wrappedClass, 'bpw-chat-bubble', `bpw-bubble-${type}`, {
          'bpw-bubble-highlight': this.props.isHighlighted,
          'bpw-msg-hovering': isEmulator
        })}
        data-from={this.props.fromLabel}
        onClick={() => this.onMessageClicked()}
        tabIndex={-1}
        style={additionalStyle}
      >
        {isSessionReset && this.renderTimestamp()}
        <div
          tabIndex={-1}
          className="bpw-chat-bubble-content"
          onContextMenu={type !== 'session_reset' ? this.handleContextMenu : () => {}}
        >
          <span className="sr-only">
            {this.props.store.intl.formatMessage({
              id: this.props.isBotMessage ? 'message.botSaid' : 'message.iSaid',
              defaultMessage: this.props.isBotMessage ? 'Virtual assistant said : ' : 'I said : '
            })}
          </span>
          {rendered}
          {!isSessionReset && this.renderTimestamp()}
        </div>
        {this.props.inlineFeedback}
      </div>
    )
  }
}

export default inject(({ store }: { store: RootStore }) => ({
  intl: store.intl
}))(injectIntl(observer(Message)))

type MessageProps = Renderer.Message & InjectedIntlProps & Pick<StoreDef, 'intl'>
