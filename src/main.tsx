/* Japanese Writing Toolkit — エントリポイント */

import { render } from 'solid-js/web'
import { App } from './app/App'
import './styles/global.css'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('ルート要素 #root が見つかりません')
}

render(() => <App />, root)
