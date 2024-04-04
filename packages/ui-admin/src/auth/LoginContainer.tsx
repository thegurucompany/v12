import { Callout, Intent } from '@blueprintjs/core'
import { lang } from 'botpress/shared'
import cx from 'classnames'
import React, { FC } from 'react'

import logo from './media/bp-logo-white.png'
import tgc_logo from './media/logo.png'
import style from './style.scss'

interface Props {
  title?: string
  subtitle?: React.ReactNode
  error?: string | null
  poweredBy?: boolean
  children: React.ReactNode
}

const LoginContainer: FC<Props> = props => {
  return (
    <div className={cx('centered-container', style.centered_container)}>
      <div className={cx('middle', style.middle)}>
        <div className={cx('inner', style.inner)}>
          <div className={cx('card', 'card_body', style.card, style.card_body)}>
            <img className={cx('logo', style.logo)} src={logo} alt="loading" />
            <div className={cx('linea_vertical', style.linea_vertical)}></div>
            <div className={cx('card_body', 'login_box', style.card_body, style.login_box)}>
              <div className={cx('tgc_logo-wrapper', style.tgc_logo_wrapper)}>
                <img src={tgc_logo} className={cx('tgc_login_img', style.tgc_login_img)} alt="tgc-logo" />
              </div>
              <div className={cx('form_wrapper', style.form_wrapper)}>
                <div className={cx('card_title', style.card_title)}>
                  <strong>{props.title || 'Botpress'}</strong>
                </div>
                <div className={cx('card_text', style.card_text)}>{props.subtitle || ''}</div>

                {props.error && <Callout intent={Intent.DANGER}>{props.error}</Callout>}
                {props.children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginContainer
