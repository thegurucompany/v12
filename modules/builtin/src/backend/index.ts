import * as sdk from 'botpress/sdk'

import en from '../translations/en.json'
import es from '../translations/es.json'
import fr from '../translations/fr.json'
import macrosApi from './macros-api'
import MacrosRepository from './macros-repository'
import configureMacrosPermissions from './workspace'

let macrosRepository: MacrosRepository

const botTemplates: sdk.BotTemplate[] = [
  { id: 'welcome-bot', name: 'Welcome Bot', desc: "Basic bot that showcases some of the bot's functionality" },
  { id: 'small-talk', name: 'Small Talk', desc: 'Includes basic smalltalk examples' },
  { id: 'empty-bot', name: 'Empty Bot', desc: 'Start fresh with a clean flow' },
  { id: 'learn-botpress', name: 'Learn Botpress Basics', desc: 'Learn Botpress basic features' }
]

const onServerReady = async (bp: typeof sdk) => {
  await configureMacrosPermissions(bp)
  macrosRepository = new MacrosRepository(bp)
  await macrosApi(bp, macrosRepository)
}

const entryPoint: sdk.ModuleEntryPoint = {
  onServerReady,
  botTemplates,
  translations: { en, fr, es },
  definition: {
    name: 'builtin',
    menuIcon: 'flash',
    menuText: 'Macros',
    fullName: 'Macros',
    homepage: 'https://botpress.com',
    noInterface: false,
    workspaceApp: { bots: true }
  }
}

export default entryPoint
