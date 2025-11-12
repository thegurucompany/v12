import * as sdk from 'botpress/sdk'
import { Workspace } from 'common/typings'
import _ from 'lodash'

const debug = DEBUG('builtin')

const ROLE_CONFIGURATION = [
  {
    id: 'agent',
    name: 'admin.workspace.roles.default.agent.name',
    description: 'admin.workspace.roles.default.agent.description',
    rules: [
      {
        res: 'module.builtin.macros',
        op: '+r-w' // Permitir lectura, denegar escritura
      }
    ]
  }
]

/**
 * Actualiza los roles de agentes para PERMITIR lectura de macros pero DENEGAR escritura
 * Los agentes pueden ver y usar las macros, pero no crear/editar/eliminar
 */
const configureMacrosPermissions = async (bp: typeof sdk) => {
  const list = () => {
    return bp.ghost.forGlobal().readFileAsObject<Workspace[]>('/', 'workspaces.json')
  }

  const save = (workspaces: Workspace[]) => {
    return bp.ghost.forGlobal().upsertFile('/', 'workspaces.json', JSON.stringify(workspaces, undefined, 2))
  }

  const updateRole = async (workspaceId: string, roleUpdates: any[]) => {
    const workspaces = await list()
    return save(
      workspaces.map(workspace => {
        if (workspace.id !== workspaceId) {
          return workspace
        }

        const updatedRoles = workspace.roles.map(role => {
          const roleUpdate = roleUpdates.find(r => r.id === role.id)
          if (!roleUpdate) {
            return role
          }

          // Agregar las nuevas reglas al rol existente
          const existingRules = role.rules || []
          const newRules = roleUpdate.rules.filter(
            newRule => !existingRules.some(existing => existing.res === newRule.res)
          )

          return {
            ...role,
            rules: [...existingRules, ...newRules]
          }
        })

        return { ...workspace, roles: updatedRoles }
      })
    )
  }

  const workspaces = await list()

  debug('Configurando permisos de macros para agentes en workspace(s):', _.map(workspaces, 'id'))
  await Promise.map(workspaces, workspace => updateRole(workspace.id, ROLE_CONFIGURATION))
}

export default configureMacrosPermissions
