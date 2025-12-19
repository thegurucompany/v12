import * as sdk from 'botpress/sdk'

import { MODULE_NAME } from './constants'
import en from '../translations/en.json'
import es from '../translations/es.json'
import fr from '../translations/fr.json'

import api from './api'
import Repository from './repository'

let repository: Repository

const onServerReady = async (bp: typeof sdk) => {
  repository = new Repository(bp)
  await api(bp, repository)
}

const onModuleUnmount = async (bp: typeof sdk) => {
  bp.http.deleteRouterForBot(MODULE_NAME)
}

const entryPoint: sdk.ModuleEntryPoint = {
  onServerReady,
  onModuleUnmount,
  translations: { en, fr, es },
  definition: {
    name: MODULE_NAME,
    menuIcon: 'tag',
    menuText: 'Tag Management',
    fullName: 'Tag Management',
    homepage: 'https://botpress.com',
    noInterface: false,
    experimental: false
  }
}

export default entryPoint
