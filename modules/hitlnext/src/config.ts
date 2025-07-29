export interface Config {
  /**
   * @param agentSessionTimeout Once an agent becomes inactive, how long before automatically switching the agent to offline. - refer to https://www.npmjs.com/package/ms for options
   * @default 10m
   */
  agentSessionTimeout: string

  /**
   * @param autoComplete
   */
  autoComplete?: IAutoComplete

  /**
   * @param messageCount Number of messages to display in the conversation history
   * @default 10
   */
  messageCount: number

  /**
   * @param handoffAlert Amount of time in minutes before an unassigned handoff turns yellow.
   * @default 5
   */
  handoffAlert?: number

  /**
   * @param defaultUsername Whether or not to display a random username for anonymous users
   * @default false
   */
  defaultUsername: boolean

  /**
   * @param botAvatarUrl Image url you want to display as avatar when an agent takes control
   */
  botAvatarUrl?: string

  /**
   * @param tags List of tags that a handoff can be associated with
   * @default []
   */
  tags?: string[]

  /**
   * @param enableConversationDeletion Whether or not to allow the agent to delete the user conversation
   * @default false
   */
  enableConversationDeletion: boolean

  /**
   * @param autoAssignConversations Whether or not to automatically assign conversations to available agents
   * @default false
   */
  autoAssignConversations: boolean

  /**
   * @param transferMessageEnabled Whether or not to show transfer/reassignment messages to users
   * @default true
   */
  transferMessageEnabled: boolean

  /**
   * @param transferMessage The message sent to the user when he is being transferred to an agent. E.g. ̀`{ "lang": "message"}`.
   * @default { "en": "You are being transferred to an agent.", "fr": "Vous êtes transféré à un agent.", "es": "Se le está transfiriendo a un agente."}
   */
  transferMessage: {
    [Key: string]: string
  }

  /**
   * @param assignMessage The message sent to the user when he has been assigned to an agent.
   * @argument agentName It is possible to specify the agent name as an argument to the message. See the example below.
   * @default { "en": "You have been assigned to our agent {{agentName}}.", "fr": "Vous avez été assigné à notre agent(e) {{agentName}}.", "es": "Ha sido asignado al agente {{agentName}}."}
   */
  assignMessage: {
    [Key: string]: string
  }

  /**
   * @param resolveMessage The message sent to the user when the conversation is resolved and they are being transferred back to the bot.
   * @default { "en": "You are being transferred back to the bot.", "fr": "Vous êtes transféré au bot.", "es": "Se le está transfiriendo de vuelta al bot."}
   */
  resolveMessage?: {
    [Key: string]: string
  }

  /**
   * @param reassignMessage The message sent to the user when their conversation is being reassigned to another agent.
   * @default { "en": "Agent {{agentName}} has reassigned your conversation. We are looking for another available agent, please wait a moment.", "es": "El agente {{agentName}} ha reasignado su conversación. Estamos buscando otro agente disponible, por favor espere un momento."}
   */
  reassignMessage?: {
    [Key: string]: string
  }

  /**
   * @param reassignSuccessMessage The message sent to the user when their conversation has been successfully reassigned to a new agent.
   * @default { "en": "Your conversation has been reassigned to agent {{agentName}}.", "es": "Su conversación ha sido reasignada al agente {{agentName}}."}
   */
  reassignSuccessMessage?: {
    [Key: string]: string
  }

  /**
   * @param reassignErrorMessage The message sent to the user when there's an error during reassignment.
   * @default { "en": "Sorry, there was an error reassigning your conversation. Your conversation has been returned to me.", "es": "Lo siento, hubo un error al reasignar su conversación. Su conversación me ha sido devuelta."}
   */
  reassignErrorMessage?: {
    [Key: string]: string
  }

  /**
   * @param eventsWebHook
   * @default {}
   */
  eventsWebHook?: Webhook

  /**
   * @param s3Config Configuration for Amazon S3 file uploads
   */
  s3Config?: {
    /**
     * @param accessKeyId AWS Access Key ID
     */
    accessKeyId: string
    /**
     * @param secretAccessKey AWS Secret Access Key
     */
    secretAccessKey: string
    /**
     * @param region AWS Region
     */
    region: string
    /**
     * @param bucket S3 Bucket name
     */
    bucket: string
  }
}

export interface IShortcut {
  name: string
  value: string
}

export interface IAutoComplete {
  /**
   * @param trigger
   * @default :
   */
  trigger: string

  /**
   * @param shortcuts
   * @default []
   * @example [{ "name": "hello", "value": "Hello friend!" }]
   */
  shortcuts: IShortcut[]
}

export interface Webhook {
  /**
   * @param url
   * @example "https://myapplicationserver.com/webhook-handler"
   */
  url?: string
  /**
   * @param headers
   * @example { "authorization": "Baerer ..." }
   */
  headers?: { [name: string]: string }
}
