import { lang } from 'botpress/shared'
import _ from 'lodash'
import React, { FC, useContext, useEffect, useState } from 'react'

import { IUser } from '../../../../types'
import style from '../../style.scss'
import { Context } from '../Store'
import { generateUsername, getOrSet } from '../utils'

interface Props {
  user: IUser
}

const UserName: FC<Props> = ({ user }) => {
  const { state, dispatch } = useContext(Context)
  const [defaultUsername, setDefaultUsername] = useState()

  // Helper function to safely extract user ID
  const getSafeUserId = (userId: any) => {
    if (!userId) {
      return 'anonymous'
    }

    // If userId is an object (from webchat initialization with custom userId)
    if (typeof userId === 'object') {
      // Get the first non-null/non-undefined value from the object
      const values = Object.values(userId).filter(val => val != null && val !== '')
      if (values.length > 0) {
        return String(values[0])
      }
      return JSON.stringify(userId).substring(0, 50) // Limit length
    }

    // If it's a string that looks like JSON, try to parse it
    if (typeof userId === 'string' && userId.startsWith('{')) {
      try {
        const parsed = JSON.parse(userId)
        // Get the first non-null/non-undefined value from the parsed object
        const values = Object.values(parsed).filter(val => val != null && val !== '')
        if (values.length > 0) {
          return String(values[0])
        }
        return userId.substring(0, 50) // Limit length for display
      } catch (e) {
        // If parsing fails, just use the string as is (truncated)
        return userId.substring(0, 50)
      }
    }

    // For regular string IDs
    return String(userId)
  }

  const safeUserId = getSafeUserId(user?.id)

  useEffect(() => {
    const username = getOrSet(
      () => _.get(state, `defaults.user.${safeUserId}.username`),
      value => {
        dispatch({
          type: 'setDefault',
          payload: {
            user: {
              [safeUserId]: {
                username: value
              }
            }
          }
        })
      },
      generateUsername()
    )

    setDefaultUsername(username)
  }, [safeUserId])

  const fallback = state.config.defaultUsername ? defaultUsername : lang.tr('module.hitlnext.user.anonymous')
  const username = _.get(user, 'attributes.fullName', fallback)

  return <span className={style.clientName}>{username}</span>
}

export default UserName
