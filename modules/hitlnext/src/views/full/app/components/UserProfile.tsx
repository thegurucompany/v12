import { Collapsible, lang } from 'botpress/shared'
import flatten from 'flat'
import _ from 'lodash'
import React, { FC, useState } from 'react'

import { IUser } from '../../../../types'
import style from '../../style.scss'

import UserName from './UserName'

const UserProfile: FC<IUser> = user => {
  const [expanded, setExpanded] = useState(true)

  // Safety check to ensure user data is valid
  if (!user || typeof user !== 'object') {
    return <div>Usuario no disponible</div>
  }

  // Ensure user.attributes exists and is an object
  const userAttributes = user.attributes && typeof user.attributes === 'object' ? user.attributes : {}

  return (
    <div>
      <div className={style.profileHeader}>
        <UserName user={user} />
        {(userAttributes as any)?.email && <p>{String((userAttributes as any).email)}</p>}
      </div>
      <Collapsible
        opened={expanded}
        toggleExpand={() => setExpanded(!expanded)}
        name={lang.tr('module.hitlnext.user.variables.heading')}
        ownProps={{ transitionDuration: 10 }}
      >
        {!_.isEmpty(userAttributes) && (
          <table className={style.table}>
            <thead>
              <tr>
                <th>{lang.tr('module.hitlnext.user.variables.variable')}</th>
                <th>{lang.tr('module.hitlnext.user.variables.value')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(userAttributes).map((entry, index) => {
                const [key, value] = entry
                let displayValue = value

                // Handle different types of values safely
                if (_.isObject(value)) {
                  try {
                    const flattened = flatten(value)
                    displayValue = JSON.stringify(flattened)
                  } catch (e) {
                    displayValue = JSON.stringify(value)
                  }
                } else if (value === null || value === undefined) {
                  displayValue = 'N/A'
                } else {
                  displayValue = String(value)
                }

                return (
                  <tr key={index}>
                    <td>{String(key)}</td>
                    <td>{displayValue}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Collapsible>
    </div>
  )
}

export default UserProfile
