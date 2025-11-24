import 'bluebird-global'
// @ts-ignore
import React from 'react'
// @ts-ignore
import { render } from 'react-dom'
import MassIncidentsPanel from './index'

const container = document.getElementById('app')
const bp = (typeof botpress !== 'undefined' && botpress) || {}
render(<MassIncidentsPanel bp={bp} />, container)
